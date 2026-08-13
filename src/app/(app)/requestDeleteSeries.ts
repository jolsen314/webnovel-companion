/** DELETE a series via the API. Returns true on a 2xx, false on any error/non-ok. */
export async function requestDeleteSeries(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/series/${id}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}