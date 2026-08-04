"use server";

import { pool } from "@/db";
import { requireUser } from "@/lib/dal";

export type BugReportFormState = { error?: string; successCount: number };

const MAX_MESSAGE_LENGTH = 5000;

export async function submitBugReport(
  prevState: BugReportFormState,
  formData: FormData,
): Promise<BugReportFormState> {
  const { id: userId, email } = await requireUser();

  const message = ((formData.get("message") as string | null) ?? "").trim();

  if (!message)
    return { error: "Describe the bug first", successCount: prevState.successCount };
  if (message.length > MAX_MESSAGE_LENGTH)
    return {
      error: `Keep it under ${MAX_MESSAGE_LENGTH} characters`,
      successCount: prevState.successCount,
    };

  await pool.query(
    "INSERT INTO bug_reports (user_id, email, message) VALUES ($1, $2, $3)",
    [userId, email, message]
  );

  return { successCount: prevState.successCount + 1 };
}
