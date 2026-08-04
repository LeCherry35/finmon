// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// useActionState calls submitBugReport(prevState, formData); the mock controls
// the returned state so we can drive the success/error branches.
const { submitBugReport } = vi.hoisted(() => ({ submitBugReport: vi.fn() }));
vi.mock("@/actions/bug-reports", () => ({ submitBugReport }));

import BugReportButton from "@/components/BugReportButton";

function openDialog() {
  return userEvent.click(screen.getByRole("button", { name: "Report a bug" }));
}

beforeEach(() => {
  submitBugReport.mockReset();
  // default: a successful submit bumps successCount
  submitBugReport.mockResolvedValue({ successCount: 1 });
});
afterEach(() => vi.clearAllMocks());

describe("BugReportButton", () => {
  it("is closed until the header button is pressed", () => {
    render(<BugReportButton />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the dialog with a message textarea", async () => {
    render(<BugReportButton />);
    await openDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What went wrong?")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    render(<BugReportButton />);
    await openDialog();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("closes when the Close button is pressed", async () => {
    render(<BugReportButton />);
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("submits the message and auto-closes on success", async () => {
    render(<BugReportButton />);
    await openDialog();

    await userEvent.type(
      screen.getByPlaceholderText("What went wrong?"),
      "The chart is empty",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => expect(submitBugReport).toHaveBeenCalledTimes(1));
    const fd = submitBugReport.mock.calls[0][1] as FormData;
    expect(fd.get("message")).toBe("The chart is empty");

    // successCount went 0 → 1, so the dialog closes itself
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("shows the action error and stays open on failure", async () => {
    submitBugReport.mockResolvedValue({
      successCount: 0,
      error: "Describe the bug first",
    });
    render(<BugReportButton />);
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Send report" }));

    expect(await screen.findByText("Describe the bug first")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
