"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { scanReceiptForTransaction } from "@/actions/receipt";
import type { TransactionFormState } from "@/actions/transactions";
import type { StagedImage } from "@/components/ReceiptUpload";

/**
 * Shared create-flow receipt logic for the desktop form and the mobile sheet.
 * Holds the staged receipt image and, the moment `createTransaction` reports a
 * new successful submit (a fresh `lastTxId`), fires a fire-and-forget scan
 * against that row and clears the stage. The scan request resolves on its own
 * and `revalidatePath` updates the row live (Processing → Ready to verify /
 * Unverified) — the transaction is "added independently" of the scan finishing.
 *
 * The staged image is mirrored into a ref so the effect can read it without
 * depending on it (and re-firing when the user merely picks a file); a
 * `handledTx` ref guards against firing twice for the same transaction.
 */
export function useReceiptScanCreate(state: TransactionFormState) {
  const [receipt, setReceiptState] = useState<StagedImage | null>(null);
  const stagedRef = useRef<StagedImage | null>(null);
  const handledTx = useRef<number | null>(null);

  const setReceipt = useCallback((img: StagedImage | null) => {
    stagedRef.current = img;
    setReceiptState(img);
  }, []);

  useEffect(() => {
    const txId = state.lastTxId;
    const staged = stagedRef.current;
    if (
      state.successCount > 0 &&
      txId != null &&
      staged &&
      handledTx.current !== txId
    ) {
      handledTx.current = txId;
      stagedRef.current = null;
      const fd = new FormData();
      fd.append("transaction_id", String(txId));
      fd.append("image", staged.dataUrl);
      void scanReceiptForTransaction(fd);
      setReceiptState(null);
    }
  }, [state.successCount, state.lastTxId]);

  return { receipt, setReceipt };
}
