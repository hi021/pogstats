import { getUserOAuthToken } from "./osu_auth.js";
import { API_BASE_URL, buildHeadersWithAuth } from "./shared.js";

async function getChatAck(authToken?: string) {
  if(!authToken) authToken = await getUserOAuthToken(["chat.read"])

  const response = await fetch(API_BASE_URL + "/chat/ack", {
    method: "POST",
    headers: buildHeadersWithAuth(authToken)
  })

    if (!response.ok) throw new Error(`Failed to get osu! chat ACK: ${response.status} ${response.statusText}`);

	const data = await response.json();
	console.log(data);
}

await getChatAck();
