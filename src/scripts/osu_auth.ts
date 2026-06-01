import { OSU_CLIENT_ID, OSU_CLIENT_SECRET } from "./env.js";

export const AUTH_ENDPOINT = "https://osu.ppy.sh/oauth/token";

export async function getOAuthToken() {
	const body = `client_id=${OSU_CLIENT_ID}&client_secret=${OSU_CLIENT_SECRET}&grant_type=client_credentials&scope=public`;

	const response = await fetch(AUTH_ENDPOINT, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded"
		},
		body
	});
	if (!response.ok) throw new Error(`Failed to get OAuth token: ${response.status} ${response.statusText}`);

	const data = await response.json();
	if (!data?.access_token) throw new Error("Invalid response from OAuth token endpoint");

	console.log("Successfully obtained OAuth token.");
	return data.access_token as string;
}
