// Tells the account page whether Shopify connections are switched on.
import { send, wrap } from "../_lib.js";
import { configured } from "./_shopify.js";
export default wrap(async (req, res) => send(res, 200, { configured: configured() && process.env.SHOPIFY_PUBLIC === "1" }), "GET");
