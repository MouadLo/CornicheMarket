import { confirmPendingSale, type PendingSale } from "@/src/lib/sales/offlineQueue";
import { recoverSale } from "@/src/lib/sales/queries";

// The owner's way out for a sale stranded on this device by a user who cannot
// sign back in (or a legacy sale with no user id). The server records it under
// the owner and keeps the original cashier in the log; only after it
// acknowledges is the sale removed from the queue. If the server call fails,
// the sale stays queued and the same id can be recovered again.
//
//   "recovered"        recorded now, credited to the owner
//   "already-recorded" it was already on the server (the cashier synced it
//                      after all): nothing was changed, the local copy is dropped
export async function recoverQueuedSale(
  sale: PendingSale
): Promise<"recovered" | "already-recorded"> {
  const recordedNow = await recoverSale(sale);
  await confirmPendingSale(sale.id);
  return recordedNow ? "recovered" : "already-recorded";
}
