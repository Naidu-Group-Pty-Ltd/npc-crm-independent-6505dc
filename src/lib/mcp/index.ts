import { defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";

export default defineMcp({
  name: "npc-command-centre-mcp",
  title: "NPC Command Centre MCP",
  version: "0.1.0",
  instructions:
    "MCP server for the NPC Command Centre app. Use `echo` to verify connectivity. Additional tools can be added under src/lib/mcp/tools/.",
  tools: [echoTool],
});
