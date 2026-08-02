const TOOL_LABELS: Record<string, string> = {
  get_settings: "Get Settings",
  update_setting: "Update Setting",
  create_agent: "Create Agent",
  update_agent: "Update Agent",
  list_agents: "List Agents",
  find_skill: "Find Skill",
  save_user_info: "Save User Info",
  list_connectors: "List Connectors",
  connect_connector: "Connect Connector",
  disconnect_connector: "Disconnect Connector",
  attach_connector_to_agent: "Attach Connector",
  detach_connector_from_agent: "Detach Connector",
  list_knowledgebase_files: "List Knowledge Files",
  read_knowledgebase_file: "Read Knowledge File",
  list_granted_folders: "List Folders",
  list_folder_contents: "Browse Folder",
  read_folder_file: "Read Folder File",
  web_search: "Web Search",
  fetch_web_content: "Fetch Web Content",
  save_agent_data: "Save Agent Data",
  get_agent_data: "Get Agent Data",
  list_agent_data: "List Agent Data",
  delete_agent_data: "Delete Agent Data",
  search_conversation_history: "Search History",
  get_current_location: "Get Current Location",
};

/** Converts a tool's raw snake_case id into a human-readable label. Never throws —
 * an id not in the lookup falls back to title-casing its snake_case words. */
export function humanizeToolName(toolName: string): string {
  const known = TOOL_LABELS[toolName];
  if (known) return known;
  return toolName
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
