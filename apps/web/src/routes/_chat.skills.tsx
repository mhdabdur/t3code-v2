import { createFileRoute } from "@tanstack/react-router";

import { SkillsPage } from "../components/library/SkillsPage";

export const Route = createFileRoute("/_chat/skills")({
  component: SkillsPage,
});
