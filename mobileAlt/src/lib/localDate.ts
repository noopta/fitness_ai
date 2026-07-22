// The app's canonical "what day is it for this user" helper.
//
// Every nutrition surface keys off the user's LOCAL calendar day, not UTC:
// meals are logged with this date string, so anything that reads them back
// (timeline, Nutrition Profile) must ask for the same local date. Defaulting
// to a server-side UTC date silently hides meals for any user whose local day
// differs from UTC — e.g. at 21:40 ET the server is already on tomorrow.
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
