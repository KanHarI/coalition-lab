import CoalitionLab from "@/components/coalition-lab";
import { snapshotData } from "@/lib/markets";

export default function Home() {
  return <CoalitionLab initialData={snapshotData()} />;
}
