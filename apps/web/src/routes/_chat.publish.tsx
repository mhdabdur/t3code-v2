import { createFileRoute } from "@tanstack/react-router";

import { PublishFilePage } from "../components/library/PublishFilePage";

export const Route = createFileRoute("/_chat/publish")({
  component: PublishFilePage,
});
