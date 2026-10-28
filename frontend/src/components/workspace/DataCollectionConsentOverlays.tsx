"use client";

import type { DataCollectionController } from "@/hooks/useDataCollection";
import type { ConsentGate } from "@/hooks/useDataCollectionConsent";
import ContributionThanksDialog from "./ContributionThanksDialog";
import DataCollectionConsentDialog from "./DataCollectionConsentDialog";

/**
 * Both data-collection dialogs, mounted once at the workspace root.
 *
 * They must not live inside the report row: the generic and sound-light
 * workspaces have a second report button group inside the result card, and a
 * gate opened from there would never find the row in its render tree.
 */
export default function DataCollectionConsentOverlays({
  collection,
  gate,
  experimentName,
}: {
  collection: DataCollectionController;
  gate: ConsentGate;
  experimentName?: string | null;
}) {
  const isManage = gate.intent === "manage";

  return (
    <>
      <DataCollectionConsentDialog
        open={gate.intent !== null && !collection.showThanks}
        intent={isManage ? "manage" : "prompt"}
        initialEnabled={gate.preference === "granted"}
        hasPhoto={Boolean(collection.sessionId)}
        photoName={collection.file?.name ?? null}
        uploading={collection.state === "uploading"}
        onConfirm={(choice) => { void gate.choose(choice); }}
        onDismiss={isManage ? gate.closeSettings : gate.decline}
      />
      <ContributionThanksDialog
        collection={collection}
        experimentName={experimentName}
        onWithdrawn={gate.decline}
      />
    </>
  );
}
