# Visual replies

Agents can answer with a page instead of only text: a chart, table, diagram, image collage, or mockup. Ask for one ("show this as a chart", "make a collage of these screenshots") and the agent builds a self-contained HTML page, which appears in the thread above its written reply. It works with every provider, on web, desktop, and mobile.

Pages use your current theme, including custom themes, and follow light and dark mode as you switch. Scripts run inside the page, but it is sandboxed away from T3 Code and your session. Links you click in a page open in your browser. Use the expand button to open a page full size; from there you can view its source or save it.

Agents can place local images in a page by file path. T3 Code embeds them when the page is published, so the page keeps working after the original files move or are deleted. Deleting the thread deletes its pages there, but each page also stays in **Publish File** in the sidebar, which lists every page agents have published across threads and providers. Asking an agent to revise a page saves the result as a new version of it, and older versions stay available.

Before publishing, agents check their work with screenshots from a small headless browser that T3 Code keeps for itself; it never uses a browser you installed. The first preview on a machine downloads it once (about 120 MB) into T3 Code's data folder, so that preview can take a minute. Pages publish without it.

## Share a page

In **Publish File**, open a page's menu and choose **Share link**. The page becomes public and its link is copied. Anyone who can reach your T3 Code server can open that link without signing in, and it always shows the page's latest version. The link works only while the server is running and reachable: on the desktop app, turn on **Network access** or **T3 Connect** in **Settings → Connections** first, or the link opens on your own machine only.

**Stop sharing** makes the page private again. The old link stops working for good; sharing again creates a new one. Deleting the page also ends its link. The same menu pins a page to the top of the list, renames it, or duplicates it.

## Publish to claude.ai

A page made by a Claude account can also go to that account's Artifacts on claude.ai. In **Publish File**, open the page's menu and choose **Publish to claude.ai**. It takes a few seconds and uses a little of the account's usage, because Claude Code itself uploads the page. The page starts out private to your Claude account; share it from its menu on claude.ai.

After an agent revises the page, **Update on claude.ai** sends the new version to the same address and replaces what was there. **Delete from claude.ai** removes the page there for good, so its link stops working for everyone, and keeps the artifact in T3 Code. **Unlink from claude.ai** only makes T3 Code forget the address, for a page you already deleted on claude.ai. Deleting an artifact in T3 Code does not delete its page on claude.ai.
