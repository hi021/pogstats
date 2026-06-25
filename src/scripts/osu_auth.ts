import { OSU_CLIENT_ID, OSU_CLIENT_SECRET } from "./env.js";
import { AUTH_ENDPOINT } from "./shared.js";

export async function getOAuthToken() {
	if (!OSU_CLIENT_ID || !OSU_CLIENT_SECRET)
		throw new Error("OSU_CLIENT_ID and OSU_CLIENT_SECRET must be set in the environment variables.");

	const body = `client_id=${OSU_CLIENT_ID}&client_secret=${OSU_CLIENT_SECRET}&grant_type=client_credentials&scope=public`;
	const response = await fetch(AUTH_ENDPOINT, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded"
		},
		body
	});
	if (!response.ok) throw new Error(`Failed to get osu! OAuth token: ${response.status} ${response.statusText}`);

	const data = await response.json();
	if (!data?.access_token) throw new Error("Invalid response from osu! OAuth token endpoint");

	console.log("Successfully obtained osu! OAuth token.");
	return data.access_token as string;
}
