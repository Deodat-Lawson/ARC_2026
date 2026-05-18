import { Hero } from "@/components/hero/Hero";
import { LiveReplayCta, SystemDemo } from "@/components/system-demo/SystemDemo";
import { MissionSection } from "@/components/mission/MissionSection";
import { RescueFlowSection } from "@/components/mission/RescueFlowSection";
import { TeamSection } from "@/components/team/TeamSection";

export default function HomePage() {
  return (
    <main className="arc-home">
      <div className="arc-home-atmosphere" aria-hidden />
      <div className="arc-home-atmosphere-grain" aria-hidden />
      <Hero />
      <MissionSection />
      <RescueFlowSection />
      <SystemDemo />
      <TeamSection />
      <LiveReplayCta />
    </main>
  );
}
