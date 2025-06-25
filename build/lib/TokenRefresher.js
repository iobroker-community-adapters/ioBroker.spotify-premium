"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenRefresher = void 0;
const axios_1 = __importDefault(require("axios"));
class TokenRefresher {
    adapter;
    stateName;
    refreshTokenTimeout;
    accessToken;
    url;
    readyPromise;
    name;
    constructor(adapter, serviceName, stateName) {
        this.adapter = adapter;
        this.stateName = stateName || 'oauth2Tokens';
        this.url = `https://oauth2.iobroker.in/${serviceName}`;
        this.name = this.stateName.replace('info.', '').replace('Tokens', '').replace('tokens', '');
        if (this.name === 'oauth2') {
            this.name = adapter.name;
        }
        this.readyPromise = this.adapter.getForeignStateAsync(`${adapter.namespace}.${this.stateName}`).then(state => {
            if (state) {
                this.accessToken = JSON.parse(state.val);
                if (this.accessToken?.access_token_expires_on &&
                    new Date(this.accessToken.access_token_expires_on).getTime() < Date.now()) {
                    this.adapter.log.error('Access token is expired. Please make a authorization again');
                }
                else {
                    this.adapter.log.debug(`Access token for ${this.name} found`);
                }
            }
            else {
                this.adapter.log.error(`No tokens for ${this.name} found`);
            }
            this.adapter
                .subscribeStatesAsync(this.stateName)
                .catch(error => this.adapter.log.error(`Cannot read tokens: ${error}`));
            return this.refreshTokens().catch(error => this.adapter.log.error(`Cannot refresh tokens: ${error}`));
        });
    }
    destroy() {
        if (this.refreshTokenTimeout) {
            this.adapter.clearTimeout(this.refreshTokenTimeout);
            this.refreshTokenTimeout = undefined;
        }
    }
    onStateChange(id, state) {
        if (state?.ack && id.endsWith(`.${this.stateName}`)) {
            if (JSON.stringify(this.accessToken) !== state.val) {
                try {
                    this.accessToken = JSON.parse(state.val);
                    this.refreshTokens().catch(error => this.adapter.log.error(`Cannot refresh tokens: ${error}`));
                }
                catch (error) {
                    this.adapter.log.error(`Cannot parse tokens: ${error}`);
                    this.accessToken = undefined;
                }
            }
        }
    }
    async getAccessToken() {
        await this.readyPromise;
        if (!this.accessToken?.access_token) {
            this.adapter.log.error(`No tokens for ${this.name} found`);
            return undefined;
        }
        if (!this.accessToken.access_token_expires_on ||
            new Date(this.accessToken.access_token_expires_on).getTime() < Date.now()) {
            this.adapter.log.error('Access token is expired. Please make a authorization again');
            return undefined;
        }
        return this.accessToken.access_token;
    }
    async refreshTokens() {
        if (this.refreshTokenTimeout) {
            this.adapter.clearTimeout(this.refreshTokenTimeout);
            this.refreshTokenTimeout = undefined;
        }
        if (!this.accessToken?.refresh_token) {
            this.adapter.log.error(`No tokens for ${this.name} found`);
            return;
        }
        if (!this.accessToken.access_token_expires_on ||
            new Date(this.accessToken.access_token_expires_on).getTime() < Date.now()) {
            this.adapter.log.error('Access token is expired. Please make an authorization again');
        }
        let expiresIn = new Date(this.accessToken.access_token_expires_on).getTime() - Date.now() - 180_000;
        if (expiresIn <= 0) {
            // Refresh token
            try {
                const response = await axios_1.default.post(this.url, this.accessToken);
                if (response.status !== 200) {
                    this.adapter.log.error(`Cannot refresh tokens: ${response.statusText}`);
                    return;
                }
                this.accessToken = response.data;
            }
            catch (error) {
                this.adapter.log.error(`Cannot refresh tokens: ${error}`);
            }
            if (this.accessToken) {
                this.accessToken.access_token_expires_on = new Date(Date.now() + this.accessToken.expires_in * 1_000).toISOString();
                expiresIn = new Date(this.accessToken.access_token_expires_on).getTime() - Date.now() - 180_000;
                await this.adapter.setState(this.stateName, JSON.stringify(this.accessToken), true);
                this.adapter.log.debug(`Tokens for ${this.name} updated`);
            }
            else {
                this.adapter.log.error(`No tokens for ${this.name} could be refreshed`);
            }
        }
        // no longer than 10 minutes, as longer timer could be not reliable
        if (expiresIn > 600_000) {
            expiresIn = 600_000;
        }
        this.refreshTokenTimeout = this.adapter.setTimeout(() => {
            this.refreshTokenTimeout = undefined;
            this.refreshTokens().catch(error => this.adapter.log.error(`Cannot refresh tokens: ${error}`));
        }, expiresIn);
    }
}
exports.TokenRefresher = TokenRefresher;
//# sourceMappingURL=TokenRefresher.js.map