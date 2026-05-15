import { Hero } from "@/components/hero/Hero";
import { SystemDemo } from "@/components/system-demo/SystemDemo";
import { MissionSection } from "@/components/mission/MissionSection";
import { RescueFlowSection } from "@/components/mission/RescueFlowSection";
import { TeamSection } from "@/components/team/TeamSection";

export default function HomePage() {
  return (
    <main>
      <Hero />
      <MissionSection />
      <RescueFlowSection />
      <SystemDemo />
      <TeamSection />
    </main>
  );
}
