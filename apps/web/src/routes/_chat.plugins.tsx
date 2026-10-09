import { createFileRoute } from "@tanstack/react-router";

import { PluginsPage } from "../components/library/PluginsPage";

export const Route = createFileRoute("/_chat/plugins")({
  component: PluginsPage,
});
