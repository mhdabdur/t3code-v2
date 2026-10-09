import { useLocation, useNavigate } from "@tanstack/react-router";
import { BlocksIcon, FileUpIcon, SparklesIcon, type LucideIcon } from "lucide-react";
import { memo } from "react";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";

const ITEMS: ReadonlyArray<{
  readonly to: "/publish" | "/plugins" | "/skills";
  readonly label: string;
  readonly icon: LucideIcon;
}> = [
  { to: "/publish", label: "Publish File", icon: FileUpIcon },
  { to: "/plugins", label: "Plugins", icon: BlocksIcon },
  { to: "/skills", label: "Skills", icon: SparklesIcon },
];

/** The Library pages, listed above the thread search. */
export const SidebarLibraryNav = memo(function SidebarLibraryNav() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {ITEMS.map((item) => (
        <SidebarMenuItem key={item.to}>
          <SidebarMenuButton
            isActive={pathname === item.to}
            onClick={() => {
              if (isMobile) setOpenMobile(false);
              void navigate({ to: item.to });
            }}
          >
            <item.icon />
            <span>{item.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
});
