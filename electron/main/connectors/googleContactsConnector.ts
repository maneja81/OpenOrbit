import { tool } from "@openai/agents";
import { z } from "zod";
import type { ConnectorCredentials } from "../db/connectorsStore";
import type { OAuthConfig } from "./oauthFlow";
import { buildGoogleOAuthConfig, makeEnsureFreshCredentials } from "./googleOAuth";
import { GOOGLE_ACCOUNT_CONNECTOR_ID } from "./googleAccountConnector";
import type { ConnectorDefinition } from "./registry";

export const GOOGLE_CONTACTS_CONNECTOR_ID = "google-contacts";

const CONTACTS_API_BASE = "https://people.googleapis.com/v1";

const CONTACTS_SCOPES = [
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts",
];

const PERSON_FIELDS = "names,emailAddresses,phoneNumbers,organizations";

export function buildContactsOAuthConfig(settings: Record<string, string> | null): OAuthConfig {
  return buildGoogleOAuthConfig(settings, CONTACTS_SCOPES, "Google Contacts");
}

export const ensureFreshContactsCredentials = makeEnsureFreshCredentials(
  GOOGLE_CONTACTS_CONNECTOR_ID,
  GOOGLE_ACCOUNT_CONNECTOR_ID,
  buildContactsOAuthConfig,
  "Google Contacts"
);

interface PersonPayload {
  resourceName?: string;
  names?: { displayName?: string; givenName?: string; familyName?: string }[];
  emailAddresses?: { value?: string }[];
  phoneNumbers?: { value?: string }[];
  organizations?: { name?: string }[];
}

function summarizePerson(person: PersonPayload) {
  return {
    resourceName: person.resourceName ?? "",
    displayName: person.names?.[0]?.displayName ?? "",
    email: person.emailAddresses?.[0]?.value ?? "",
    phone: person.phoneNumbers?.[0]?.value ?? "",
  };
}

/** Calls GET /v1/people/me and returns the account's email (or display name if no email)
 * as the label. Shared by testContactsConnection (liveness check) and the connect flow. */
async function callPeopleMe(accessToken: string): Promise<PersonPayload> {
  const response = await fetch(`${CONTACTS_API_BASE}/people/me?personFields=names,emailAddresses`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google Contacts connection test failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as PersonPayload;
}

/** Makes a real live API call to verify credentials and returns the account's email (or
 * display name as a fallback) as the label. Throws on any API failure — the caller decides
 * whether that's fatal. Handles token refresh automatically via
 * ensureFreshContactsCredentials. */
export async function testContactsConnection(credentials: ConnectorCredentials): Promise<{ label?: string }> {
  const fresh = await ensureFreshContactsCredentials(credentials);
  const me = await callPeopleMe(fresh.accessToken);
  return { label: me.emailAddresses?.[0]?.value ?? me.names?.[0]?.displayName };
}

function buildContactsTools(credentials: ConnectorCredentials) {
  const listContactsTool = tool({
    name: "google_contacts_list_contacts",
    description:
      "List contacts in the user's connected Google Contacts. `query`, if given, filters the returned page " +
      "by substring match on name or email — this is a client-side filter over one page of results, not a " +
      "full-text search across the whole contact list.",
    parameters: z.object({
      maxResults: z.number().int().min(1).max(50).default(25).describe("Max contacts to return (default 25)."),
      query: z.string().optional().describe("Substring to filter results by (matched against name and email)."),
    }),
    execute: async ({ maxResults, query }) => {
      const fresh = await ensureFreshContactsCredentials(credentials);
      const url = new URL(`${CONTACTS_API_BASE}/people/me/connections`);
      url.searchParams.set("personFields", PERSON_FIELDS);
      url.searchParams.set("pageSize", String(maxResults));
      const response = await fetch(url, { headers: { Authorization: `Bearer ${fresh.accessToken}` } });
      if (!response.ok) {
        throw new Error(`Google Contacts list failed (${response.status}): ${await response.text()}`);
      }
      const data = (await response.json()) as { connections?: PersonPayload[] };
      let contacts = (data.connections ?? []).map(summarizePerson);
      if (query) {
        const needle = query.toLowerCase();
        contacts = contacts.filter(
          (c) => c.displayName.toLowerCase().includes(needle) || c.email.toLowerCase().includes(needle)
        );
      }
      return { contacts };
    },
  });

  const getContactTool = tool({
    name: "google_contacts_get_contact",
    description: "Get full details for one contact in the user's connected Google Contacts by resource name.",
    parameters: z.object({
      resourceName: z.string().describe("The contact's resource name, e.g. 'people/c1234567890'."),
    }),
    execute: async ({ resourceName }) => {
      const fresh = await ensureFreshContactsCredentials(credentials);
      const url = new URL(`${CONTACTS_API_BASE}/${resourceName}`);
      url.searchParams.set("personFields", PERSON_FIELDS);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${fresh.accessToken}` } });
      if (!response.ok) {
        throw new Error(`Google Contacts get failed (${response.status}): ${await response.text()}`);
      }
      const person = (await response.json()) as PersonPayload;
      return {
        resourceName: person.resourceName ?? resourceName,
        displayName: person.names?.[0]?.displayName ?? "",
        emails: (person.emailAddresses ?? []).map((e) => e.value ?? "").filter(Boolean),
        phones: (person.phoneNumbers ?? []).map((p) => p.value ?? "").filter(Boolean),
        organization: person.organizations?.[0]?.name ?? "",
      };
    },
  });

  const createContactTool = tool({
    name: "google_contacts_create_contact",
    description: "Create a new contact in the user's connected Google Contacts.",
    parameters: z.object({
      givenName: z.string().describe("First name."),
      familyName: z.string().optional().describe("Last name."),
      email: z.string().optional().describe("Email address."),
      phone: z.string().optional().describe("Phone number."),
    }),
    execute: async ({ givenName, familyName, email, phone }) => {
      const fresh = await ensureFreshContactsCredentials(credentials);
      const body = {
        names: [{ givenName, familyName }],
        emailAddresses: email ? [{ value: email }] : undefined,
        phoneNumbers: phone ? [{ value: phone }] : undefined,
      };
      const response = await fetch(`${CONTACTS_API_BASE}/people:createContact`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fresh.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`Google Contacts create failed (${response.status}): ${await response.text()}`);
      }
      const person = (await response.json()) as PersonPayload;
      return {
        resourceName: person.resourceName ?? "",
        displayName: person.names?.[0]?.displayName ?? "",
      };
    },
  });

  return [listContactsTool, getContactTool, createContactTool];
}

export const googleContactsConnectorDefinition: ConnectorDefinition = {
  id: GOOGLE_CONTACTS_CONNECTOR_ID,
  name: "Google Contacts",
  description: "Search, read, and create contacts in the user's connected Google Contacts.",
  icon: "ti-address-book",
  authType: "oauth2",
  settingsFields: [],
  settingsSourceId: GOOGLE_ACCOUNT_CONNECTOR_ID,
  buildOAuthConfig: buildContactsOAuthConfig,
  buildTools: buildContactsTools,
  testConnection: testContactsConnection,
};
