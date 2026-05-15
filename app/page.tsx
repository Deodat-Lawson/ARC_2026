import { Hero } from "@/components/hero/Hero";
import { SystemDemo } from "@/components/system-demo/SystemDemo";
import { MissionSection } from "@/components/mission/MissionSection";
import { TeamSection } from "@/components/team/TeamSection";

export default function HomePage() {
  return (
    <main>
      <Hero />
      <MissionSection />
      <SystemDemo />
      <TeamSection />
    </main>
  );
}
