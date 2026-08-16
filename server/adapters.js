import { jsonFetch } from "./http.js";

/*
|--------------------------------------------------------------------------
| OpenSky OAuth2
|--------------------------------------------------------------------------
*/

const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

const OPENSKY_API_URL =
  "https://opensky-network.org/api";

let cachedToken = null;
let cachedTokenExpiresAt = 0;

const TOKEN_REFRESH_MARGIN_MS =
  60 * 1000;

/*
|--------------------------------------------------------------------------
| USGS EARTHQUAKES
|--------------------------------------------------------------------------
*/

export async function earthquakes() {
  return jsonFetch(
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"
  );
}

/*
|--------------------------------------------------------------------------
| GET OPEN SKY ACCESS TOKEN
|--------------------------------------------------------------------------
*/

async function getOpenSkyToken() {
  const clientId =
    process.env.OPENSKY_CLIENT_ID;

  const clientSecret =
    process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId) {
    throw new Error(
      "OPENSKY_CLIENT_ID is missing"
    );
  }

  if (!clientSecret) {
    throw new Error(
      "OPENSKY_CLIENT_SECRET is missing"
    );
  }

  const now = Date.now();

  /*
   * Reuse the current token until shortly before expiry.
   */
  if (
    cachedToken &&
    now <
      cachedTokenExpiresAt -
        TOKEN_REFRESH_MARGIN_MS
  ) {
    return cachedToken;
  }

  const body =
    new URLSearchParams({
      grant_type:
        "client_credentials",

      client_id:
        clientId,

      client_secret:
        clientSecret
    });

  const response =
    await fetch(
      OPENSKY_TOKEN_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",

          Accept:
            "application/json"
        },

        body:
          body.toString()
      }
    );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `OpenSky OAuth token request failed: HTTP ${response.status} ${text}`
    );
  }

  const data =
    await response.json();

  if (
    !data ||
    !data.access_token
  ) {
    throw new Error(
      "OpenSky OAuth response did not contain an access token"
    );
  }

  cachedToken =
    data.access_token;

  const expiresIn =
    Number(
      data.expires_in || 1800
    );

  cachedTokenExpiresAt =
    Date.now() +
    expiresIn * 1000;

  return cachedToken;
}

/*
|--------------------------------------------------------------------------
| OPEN SKY AIRCRAFT
|--------------------------------------------------------------------------
*/

export async function opensky() {
  const token =
    await getOpenSkyToken();

  const response =
    await fetch(
      `${OPENSKY_API_URL}/states/all`,
      {
        headers: {
          Accept:
            "application/json",

          Authorization:
            `Bearer ${token}`,

          "User-Agent":
            "WorldView-Godseye/1.0"
        }
      }
    );

  /*
   * If the token is rejected, clear it so that the next
   * request obtains a fresh token.
   */
  if (
    response.status === 401
  ) {
    cachedToken = null;
    cachedTokenExpiresAt = 0;

    throw new Error(
      "OpenSky access token was rejected or expired"
    );
  }

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `OpenSky aircraft request failed: HTTP ${response.status} ${text}`
    );
  }

  return response.json();
}

/*
|--------------------------------------------------------------------------
| CELESTRAK SATELLITES
|--------------------------------------------------------------------------
*/

export async function satellites(
  group = "visual"
) {
  const url =
    `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(
      group
    )}&FORMAT=JSON`;

  return jsonFetch(
    url,
    {
      headers: {
        Accept:
          "application/json",

        "User-Agent":
          "WorldView-Godseye/1.0"
      }
    }
  );
}
