import type { Metadata } from "next";
import { RoadmapView } from "./RoadmapView";

export const metadata: Metadata = {
  title: "Roadmap · STELX",
  description: "What's live, what's being built, and who's on it.",
};

export default function RoadmapPage() {
  return <RoadmapView />;
}
