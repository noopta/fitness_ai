/**
 * RAG Ingestion Script
 * Usage: npx tsx scripts/ingestPDFs.ts [--source NASM] [--dry-run]
 *
 * Parses certification PDFs, chunks text, embeds with OpenAI text-embedding-3-small,
 * stores in the KnowledgeChunk table. Safe to re-run — existing chunks for a source
 * are deleted before re-inserting (idempotent per source).
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const PDF_DIR = path.join(__dirname, '../../Certification_Textbooks');

const PDF_SOURCES: Array<{ file: string; source: string }> = [
  {
    file: 'NASM Essentials of Personal Fitness Training, 6th Edition -- Micheal Clark, Brian G. Sutton, Scott Lucett, National -- ( WeLib.org ).pdf',
    source: 'NASM',
  },
  {
    file: 'a2ccc60ae9064b80daaa9ee86edc46f7_ACE Personal Trainer Manual Study Companion Fifth Edition -- American Council on Exercise; Project editor Daniel J Green -- ( WeLib.org ).pdf',
    source: 'ACE',
  },
  {
    file: 'Advanced Concepts of Personal Training, 2nd Ed -- Arturo Leyva, PhD; Davy Levy, MS; Jennifer Maher, PhD; -- ( WeLib.org ).pdf',
    source: 'NCSF',
  },
  {
    file: 'f9468a7174eadc1000de9b5c81d04864_NFPT Manual -- NFPT -- ( WeLib.org ).pdf',
    source: 'NFPT',
  },
];

// ~600 tokens ≈ 2400 chars. Overlap: ~80 tokens ≈ 320 chars.
const CHUNK_SIZE_CHARS = 2400;
const CHUNK_OVERLAP_CHARS = 320;
const EMBED_BATCH_SIZE = 20; // OpenAI embeddings per API call
const MIN_CHUNK_CHARS = 200; // Skip very short chunks (page numbers, headers)

function cleanText(raw: string): string {
  return raw
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove form-feed / page break characters
    .replace(/\f/g, '\n\n')
    // Collapse runs of 3+ newlines to two (preserve paragraph breaks)
    .replace(/\n{3,}/g, '\n\n')
    // Fix hyphenated line breaks (word-\ncontinued → wordcontinued)
    .replace(/(\w)-\n(\w)/g, '$1$2')
    // Remove lone page numbers (lines that are just digits, optionally with spaces)
    .replace(/^\s*\d{1,4}\s*$/gm, '')
    // Remove lines that look like headers/footers (all caps, short)
    .replace(/^[A-Z\s]{3,40}$/gm, (match) => (match.trim().split(/\s+/).length <= 5 ? '' : match))
    // Collapse multiple spaces
    .replace(/[ \t]{2,}/g, ' ')
    // Trim each line
    .split('\n').map(l => l.trim()).join('\n')
    .trim();
}

/**
 * Extract a best-guess chapter/section heading for context.
 * Looks for lines that are short, title-cased or all-caps before the chunk content.
 */
function extractHeading(text: string): string | null {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  for (const line of lines.slice(0, 5)) {
    const t = line.trim();
    // Short line (3–80 chars), starts with capital, not a full sentence
    if (t.length >= 3 && t.length <= 80 && !t.endsWith('.') && /^[A-Z]/.test(t)) {
      return t;
    }
  }
  return null;
}

function splitIntoChunks(text: string): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';
  let overlap = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if ((current + '\n\n' + trimmed).length > CHUNK_SIZE_CHARS && current.length > 0) {
      chunks.push(current.trim());
      // Overlap: keep the tail of the current chunk
      const tail = current.slice(-CHUNK_OVERLAP_CHARS);
      // Find the start of a word boundary in the overlap
      const wordBoundary = tail.indexOf(' ');
      overlap = wordBoundary > 0 ? tail.slice(wordBoundary + 1) : tail;
      current = overlap + '\n\n' + trimmed;
    } else {
      current = current ? current + '\n\n' + trimmed : trimmed;
    }
  }

  if (current.trim().length > MIN_CHUNK_CHARS) {
    chunks.push(current.trim());
  }

  return chunks.filter(c => c.length >= MIN_CHUNK_CHARS);
}

/** Estimate token count: ~1 token per 4 chars */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding);
}

async function ingestSource(
  pdfPath: string,
  source: string,
  dryRun: boolean
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SOURCE: ${source}`);
  console.log(`FILE:   ${path.basename(pdfPath)}`);
  console.log(`${'='.repeat(60)}`);

  if (!fs.existsSync(pdfPath)) {
    console.error(`  ✗ File not found: ${pdfPath}`);
    return;
  }

  // Parse PDF
  console.log('  Parsing PDF...');
  const buffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(buffer, { max: 0 }); // max:0 = all pages
  console.log(`  Pages: ${data.numpages}  Raw chars: ${data.text.length.toLocaleString()}`);

  // Clean
  const cleaned = cleanText(data.text);
  console.log(`  Cleaned chars: ${cleaned.length.toLocaleString()}`);

  // Chunk
  const chunks = splitIntoChunks(cleaned);
  console.log(`  Chunks: ${chunks.length}  (avg ${Math.round(chunks.reduce((s, c) => s + c.length, 0) / chunks.length)} chars)`);

  if (dryRun) {
    console.log('\n  [DRY RUN] First 3 chunks:\n');
    chunks.slice(0, 3).forEach((c, i) => {
      console.log(`  --- Chunk ${i + 1} (${c.length} chars) ---`);
      console.log('  ' + c.slice(0, 300).replace(/\n/g, '\n  '));
      console.log();
    });
    return;
  }

  // Clear existing chunks for this source (idempotent)
  const existing = await prisma.knowledgeChunk.count({ where: { source } });
  if (existing > 0) {
    console.log(`  Deleting ${existing} existing chunks for ${source}...`);
    await prisma.knowledgeChunk.deleteMany({ where: { source } });
  }

  // Embed in batches and store
  let stored = 0;
  let skipped = 0;
  const total = chunks.length;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const batchNum = Math.floor(i / EMBED_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(total / EMBED_BATCH_SIZE);

    process.stdout.write(`  Embedding batch ${batchNum}/${totalBatches}...`);

    try {
      const embeddings = await embedBatch(batch);

      // Store each chunk with its embedding
      for (let j = 0; j < batch.length; j++) {
        const content = batch[j];
        const embedding = embeddings[j];
        const chapter = extractHeading(content);
        const tokenCount = estimateTokens(content);

        await prisma.knowledgeChunk.create({
          data: {
            source,
            chapter,
            content,
            embedding: JSON.stringify(embedding),
            tokenCount,
          },
        });
        stored++;
      }

      process.stdout.write(` ✓ (${stored}/${total})\n`);
    } catch (err: any) {
      process.stdout.write(` ✗ ERROR: ${err.message}\n`);
      skipped += batch.length;
    }

    // Brief pause to respect rate limits
    if (i + EMBED_BATCH_SIZE < chunks.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`  ✅ ${source} complete: ${stored} stored, ${skipped} skipped`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const sourceFilter = args.find((a, i) => args[i - 1] === '--source');

  console.log('\n🔬 LiftOff RAG Ingestion');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  if (sourceFilter) console.log(`Filter: ${sourceFilter} only`);

  const sources = sourceFilter
    ? PDF_SOURCES.filter(s => s.source === sourceFilter)
    : PDF_SOURCES;

  if (sources.length === 0) {
    console.error(`No sources matched filter: ${sourceFilter}`);
    process.exit(1);
  }

  const startTime = Date.now();

  for (const { file, source } of sources) {
    await ingestSource(path.join(PDF_DIR, file), source, dryRun);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!dryRun) {
    const total = await prisma.knowledgeChunk.count();
    const bySource = await prisma.knowledgeChunk.groupBy({
      by: ['source'],
      _count: { id: true },
    });
    console.log('\n📊 Final DB state:');
    bySource.forEach(r => console.log(`   ${r.source}: ${r._count.id} chunks`));
    console.log(`   Total: ${total} chunks`);
  }

  console.log(`\n⏱  Done in ${elapsed}s`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
