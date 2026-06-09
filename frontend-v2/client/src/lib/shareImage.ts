// Render a DOM node to a PNG and either hand it to the Web Share API (so it
// can go straight to X / Instagram / Messages on supporting browsers) or fall
// back to a download. Used by the nutrition + weight progress share cards.
import { toPng } from 'html-to-image';

export async function shareOrDownloadNode(
  node: HTMLElement,
  filename: string,
  title = 'My progress',
): Promise<void> {
  const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true });
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: any) => boolean };
    if (nav.canShare && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title });
      return;
    }
  } catch {
    // Web Share with files unsupported or user cancelled — fall through.
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
