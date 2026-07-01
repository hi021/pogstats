import { OSU_CLIENT_ID, OSU_CLIENT_SECRET } from "./env.js";
import { AUTH_ENDPOINT, buildRandomString, USER_AUTH_ENDPOINT } from "./shared.js";

export async function getOAuthToken(grantType = "client_credentials", code?: string) {
	if (!OSU_CLIENT_ID || !OSU_CLIENT_SECRET)
		throw new Error("OSU_CLIENT_ID and OSU_CLIENT_SECRET must be set in the environment variables.");

	const body = `client_id=${OSU_CLIENT_ID}&client_secret=${OSU_CLIENT_SECRET}&grant_type=${grantType}&scope=public${code ? `&code=${code}` : ""}`;
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

// This just returns the osu! auth page where you need to provide credentials
// so it's all probably not useful
export async function getUserOAuthCode(scopes: OsuAuthScope[], responseType = "code") {
	if (!OSU_CLIENT_ID) throw new Error("OSU_CLIENT_ID must be set in the environment variables.");

	const scope = scopes.join(" ");
	const state = buildRandomString();
	const url = new URL(USER_AUTH_ENDPOINT);
	url.searchParams.set("scope", scope);
	url.searchParams.set("state", state);
	url.searchParams.set("response_type", responseType);
	url.searchParams.set("client_id", OSU_CLIENT_ID);

	const response = await fetch(url, {
		method: "GET",
		headers: {
			Accept: "application/json"
		}
	});
	if (!response.ok) throw new Error(`Failed to get osu! user OAuth code: ${response.status} ${response.statusText}`);

	const data = await response.json();
	console.log(data);

	console.log("Successfully obtained osu! user OAuth code.");
	return data as string;
}

export async function getUserOAuthToken(scopes: OsuAuthScope[]) {
	const code = await getUserOAuthCode(scopes);
	return await getOAuthToken("authorization_code", code);
}
