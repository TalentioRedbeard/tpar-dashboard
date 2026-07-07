// /training — the in-app onboarding presentation. Hosts TPAR's 7 walkthrough
// clips (public Supabase Storage bucket `training-clips`) as an ordered,
// phone-first playlist. Auth-gated by middleware, so any signed-in tech/staff
// member reaches it — this is the surface everyone gets on day one.

import { PageShell } from "@/components/PageShell";
import { TRAINING_CLIPS, totalRuntime } from "@/lib/training-clips";
import { TrainingPlayer } from "./TrainingPlayer";

export const dynamic = "force-dynamic";
export const metadata = { title: "App training · TPAR-DB" };

export default function TrainingPage() {
  return (
    <PageShell
      kicker="Onboarding"
      title="TPAR App Training"
      description={`${TRAINING_CLIPS.length} short chapters — about ${totalRuntime()} start to finish. Watch them in order the first time; come back to any one whenever you need a refresher.`}
      backHref="/me"
      backLabel="Back to your day"
      hideAskBar
    >
      <TrainingPlayer clips={TRAINING_CLIPS} />
    </PageShell>
  );
}
