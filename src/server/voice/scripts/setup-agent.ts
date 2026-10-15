// Creates or updates the ElevenLabs collections agent and assigns the
// integrated Twilio number to it. Prints IDs only, never secrets.
//
//   npx tsx --env-file=.env.local src/server/voice/scripts/setup-agent.ts
import { agentConfigBody } from "../agent-config";

const base = process.env.ELEVENLABS_API_BASE_URL || "https://api.elevenlabs.io";
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error("ELEVENLABS_API_KEY is required");

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "xi-api-key": apiKey!, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

async function main() {
  let agentId = process.env.ELEVENLABS_AGENT_ID;
  if (agentId) {
    await call("PATCH", `/v1/convai/agents/${agentId}`, agentConfigBody());
    console.log(`updated agent ${agentId}`);
  } else {
    agentId = (await call("POST", "/v1/convai/agents/create", agentConfigBody())).agent_id;
    console.log(`created agent ${agentId}  -> set ELEVENLABS_AGENT_ID`);
  }

  const numbers: { phone_number_id: string; phone_number: string; provider: string }[] = await call("GET", "/v1/convai/phone-numbers");
  const wanted = process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID;
  const number = numbers.find((n) => n.phone_number_id === wanted) ?? (numbers.length === 1 ? numbers[0] : undefined);
  if (!number) {
    console.log("no phone number assigned: import a Twilio number in ElevenLabs and set ELEVENLABS_AGENT_PHONE_NUMBER_ID");
    return;
  }
  await call("PATCH", `/v1/convai/phone-numbers/${number.phone_number_id}`, { agent_id: agentId });
  console.log(`assigned ${number.provider} number ${number.phone_number} (${number.phone_number_id}) to agent`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
