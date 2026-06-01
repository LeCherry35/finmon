/** Build a FormData from a plain object; undefined values are skipped. */
export function formData(
  fields: Record<string, string | number | undefined>,
): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) fd.set(k, String(v));
  }
  return fd;
}

/** The fixed user id returned by the mocked `requireUser` in action tests. */
export const TEST_USER_ID = "user-1";
