export const MEDICAL_DISCLAIMER =
  'Anakin is an AI coach, not a medical professional. For pain, injury or health conditions, see a qualified clinician.';

/** One-line "not medical advice" notice shown next to AI coaching output. */
export function MedicalDisclaimer({ className = '' }: { className?: string }) {
  return (
    <p className={`text-[11px] leading-snug text-muted-foreground ${className}`} data-testid="medical-disclaimer">
      {MEDICAL_DISCLAIMER}
    </p>
  );
}
