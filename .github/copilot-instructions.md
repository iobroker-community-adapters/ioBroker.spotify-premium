# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

**Adapter-Specific Context:**
- **Adapter Name:** spotify-premium  
- **Primary Function:** Control Spotify Premium API for music playback, device management, and playlist handling
- **Key Dependencies:** Spotify Web API, OAuth 2.0 authentication, axios for HTTP requests, dns-lookup-cache for performance optimization
- **Configuration Requirements:** Spotify Client ID/Secret, OAuth authorization flow with redirect URI handling
- **Target Devices/Services:** Spotify Premium accounts and all associated playback devices (computers, smartphones, speakers, smart displays)
- **Key Features:** Playback control (play/pause/skip), volume control, device switching, playlist management, track information, shuffle/repeat modes
- **Data Polling:** Uses configurable intervals for status updates (10s), device discovery (5s), and playlist synchronization (60s recommended)

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        harness = getHarness();
                        
                        // Get adapter object using promisified pattern
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) {
                            return reject(new Error('Adapter object not found'));
                        }

                        // Configure adapter properties
                        Object.assign(obj.native, {
                            position: TEST_COORDINATES,
                            createCurrently: true,
                            createHourly: true,
                            createDaily: true,
                            // Add other configuration as needed
                        });

                        // Set the updated configuration
                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        
                        // Start adapter and wait
                        await harness.startAdapterAndWait();
                        
                        console.log('✅ Step 2: Adapter started');

                        // Wait for adapter to process data
                        const waitMs = 15000;
                        await wait(waitMs);

                        console.log('🔍 Step 3: Checking states after adapter run...');
                        
                        // Read state data
                        const stateList = await harness.states.getKeysAsync('*');
                        console.log(`Found ${stateList.length} states`);
                        
                        // Check for expected states/data structure
                        const expectedStates = [
                            'your-adapter.0.info.connection'
                        ];
                        
                        for (const expectedState of expectedStates) {
                            const val = await harness.states.getStateAsync(expectedState);
                            console.log(`${expectedState}: ${JSON.stringify(val)}`);
                            if (!val) {
                                return reject(new Error(`Expected state ${expectedState} not found`));
                            }
                        }

                        console.log('✅ All tests passed');
                        resolve();
                    } catch (error) {
                        console.error('❌ Test failed:', error.message);
                        reject(error);
                    }
                });
            }).timeout(120000); // 2 minute timeout
        });
    }
});
```

#### Key Testing Principles
- **Always** use the `@iobroker/testing` framework - no custom testing approaches
- Test both adapter initialization and data processing
- Include reasonable timeouts (30s-2min for integration tests)
- Verify state creation and data structures
- Test configuration handling and validation
- Mock external dependencies when possible

#### Test Configuration Examples
```javascript
// Configuration for testing with specific settings
Object.assign(obj.native, {
    client_id: "test_client_id",
    client_secret: "test_client_secret", 
    status_interval: 5,
    device_interval: 3,
    playlist_interval: 30,
    // Override with test-specific values
});
```

## Core Concepts and Architecture

### ioBroker Fundamentals
- **Adapter**: Main component that connects ioBroker to external systems
- **States**: Data points that hold values (e.g., sensor readings, device status)
- **Objects**: Metadata describing states (type, role, read/write permissions)
- **Instance**: Running copy of an adapter with specific configuration

### State Management Best Practices
```javascript
// Always check if adapter is still running before state operations
if (!this.adapter) return;

// Use proper state roles and types
await this.setObjectNotExistsAsync('player.volume', {
    type: 'state',
    common: {
        name: 'Volume',
        type: 'number',
        role: 'level.volume',
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: '%'
    },
    native: {}
});

// Set states with acknowledge flag when reading from device
await this.setStateAsync('player.volume', { val: 75, ack: true });

// Handle state changes (user commands)
this.on('stateChange', (id, state) => {
    if (state && !state.ack) {
        // User changed this state - process command
        this.processCommand(id, state.val);
    }
});
```

### OAuth 2.0 Authentication Patterns
```javascript
// Spotify OAuth implementation pattern
class SpotifyAuth {
    constructor(clientId, clientSecret, redirectUri) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;  
        this.redirectUri = redirectUri;
    }
    
    generateAuthUrl() {
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.clientId,
            scope: 'user-read-playback-state user-modify-playback-state',
            redirect_uri: this.redirectUri,
            state: this.generateState()
        });
        return `https://accounts.spotify.com/authorize?${params}`;
    }
    
    async exchangeCodeForToken(code) {
        // Exchange authorization code for access/refresh tokens
        const response = await axios.post('https://accounts.spotify.com/api/token', {
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: this.redirectUri,
            client_id: this.clientId,
            client_secret: this.clientSecret
        });
        return response.data;
    }
}
```

### API Rate Limiting and Error Handling
```javascript
// Spotify API rate limiting best practices
class SpotifyAPI {
    constructor(accessToken) {
        this.accessToken = accessToken;
        this.rateLimitRemaining = 1;
        this.rateLimitReset = Date.now();
    }
    
    async makeRequest(endpoint, options = {}) {
        try {
            // Check rate limits before making request
            if (this.rateLimitRemaining <= 0 && Date.now() < this.rateLimitReset) {
                const waitTime = this.rateLimitReset - Date.now();
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
            
            const response = await axios({
                url: `https://api.spotify.com/v1${endpoint}`,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                ...options
            });
            
            // Update rate limit info from response headers
            this.updateRateLimit(response.headers);
            return response.data;
            
        } catch (error) {
            if (error.response?.status === 429) {
                // Rate limited - wait and retry
                const retryAfter = error.response.headers['retry-after'] || 1;
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                return this.makeRequest(endpoint, options);
            } else if (error.response?.status === 401) {
                // Token expired - refresh and retry
                await this.refreshToken();
                return this.makeRequest(endpoint, options);
            }
            throw error;
        }
    }
}
```

### Logging Best Practices
```javascript
// Use appropriate log levels
this.log.error('Critical error that prevents adapter from working');
this.log.warn('Non-critical issue that should be addressed');
this.log.info('Important information for users');
this.log.debug('Detailed information for troubleshooting');

// Include context in error messages
this.log.error(`Failed to update device ${deviceId}: ${error.message}`);

// Log API interactions at debug level
this.log.debug(`Spotify API call: GET /me/player - Response: ${response.status}`);
```

### Device and Playlist Management Patterns
```javascript
// Device discovery and management
async updateDevices() {
    try {
        const devices = await this.spotifyAPI.getDevices();
        
        // Create device states
        for (const device of devices) {
            await this.setObjectNotExistsAsync(`devices.${device.id}`, {
                type: 'device',
                common: {
                    name: device.name,
                    icon: this.getDeviceIcon(device.type)
                },
                native: { deviceId: device.id }
            });
            
            await this.setStateAsync(`devices.${device.id}.active`, {
                val: device.is_active,
                ack: true
            });
        }
    } catch (error) {
        this.log.error(`Failed to update devices: ${error.message}`);
    }
}

// Playlist handling with proper data structure
async updatePlaylists() {
    const playlists = await this.spotifyAPI.getPlaylists();
    const playlistIds = [];
    const playlistNames = [];
    
    for (const playlist of playlists.items) {
        const playlistId = `${playlist.owner.id}-${playlist.id}`;
        playlistIds.push(playlistId);
        playlistNames.push(playlist.name);
    }
    
    await this.setStateAsync('playlists.playlistListIds', {
        val: playlistIds.join(';'),
        ack: true
    });
    
    await this.setStateAsync('playlists.playlistListString', {
        val: playlistNames.join(';'),
        ack: true
    });
}
```

## Common Error Handling Patterns

### Network and API Errors
```javascript
// Robust error handling for external APIs
async callSpotifyAPI(endpoint, options = {}) {
    const maxRetries = 3;
    let retries = 0;
    
    while (retries < maxRetries) {
        try {
            return await this.spotifyAPI.makeRequest(endpoint, options);
        } catch (error) {
            retries++;
            
            if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
                this.log.warn(`Network error (${error.code}), retry ${retries}/${maxRetries}`);
                await new Promise(resolve => setTimeout(resolve, 5000 * retries));
                continue;
            } else if (error.response?.status >= 500) {
                this.log.warn(`Server error (${error.response.status}), retry ${retries}/${maxRetries}`);
                await new Promise(resolve => setTimeout(resolve, 2000 * retries));
                continue;
            } else {
                throw error; // Don't retry client errors
            }
        }
    }
    
    throw new Error(`Failed after ${maxRetries} retries`);
}
```

### Resource Cleanup
```javascript
// Proper cleanup in unload method
unload(callback) {
    try {
        // Clear all timers
        if (this.statusTimer) {
            clearTimeout(this.statusTimer);
            this.statusTimer = null;
        }
        if (this.deviceTimer) {
            clearTimeout(this.deviceTimer);  
            this.deviceTimer = null;
        }
        
        // Close any open connections
        if (this.apiConnection) {
            this.apiConnection.close();
            this.apiConnection = null;
        }
        
        // Clear cached data
        this.tokenInfo = null;
        this.deviceCache = {};
        
        callback();
    } catch (error) {
        this.log.error(`Error during cleanup: ${error.message}`);
        callback();
    }
}
```

## Code Style and Standards

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

## CI/CD and Testing Integration

### GitHub Actions for API Testing
For adapters with external API dependencies, implement separate CI/CD jobs:

```yaml
# Tests API connectivity with demo credentials (runs separately)
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run demo API tests
      run: npm run test:integration-demo
```

### CI/CD Best Practices
- Run credential tests separately from main test suite
- Use ubuntu-22.04 for consistency
- Don't make credential tests required for deployment
- Provide clear failure messages for API connectivity issues
- Use appropriate timeouts for external API calls (120+ seconds)

### Package.json Script Integration
Add dedicated script for credential testing:
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

### Practical Example: Complete API Testing Implementation
Here's a complete example based on lessons learned from the Discovergy adapter:

#### test/integration-demo.js
```javascript
const path = require("path");
const { tests } = require("@iobroker/testing");

// Helper function to encrypt password using ioBroker's encryption method
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    
    if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }
    
    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    
    return result;
}

// Run integration tests with demo credentials
tests.integration(path.join(__dirname, ".."), {
    defineAdditionalTests({ suite }) {
        suite("API Testing with Demo Credentials", (getHarness) => {
            let harness;
            
            before(() => {
                harness = getHarness();
            });

            it("Should connect to API and initialize with demo credentials", async () => {
                console.log("Setting up demo credentials...");
                
                if (harness.isAdapterRunning()) {
                    await harness.stopAdapter();
                }
                
                const encryptedPassword = await encryptPassword(harness, "demo_password");
                
                await harness.changeAdapterConfig("your-adapter", {
                    native: {
                        username: "demo@provider.com",
                        password: encryptedPassword,
                        // other config options
                    }
                });

                console.log("Starting adapter with demo credentials...");
                await harness.startAdapter();
                
                // Wait for API calls and initialization
                await new Promise(resolve => setTimeout(resolve, 60000));
                
                const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
                
                if (connectionState && connectionState.val === true) {
                    console.log("✅ SUCCESS: API connection established");
                    return true;
                } else {
                    throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
                        "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
                }
            }).timeout(120000);
        });
    }
});
```

**Adapter-Specific Testing Patterns:**
- Mock Spotify API responses for unit tests to avoid rate limiting
- Test OAuth authorization flow with invalid/expired tokens
- Verify proper handling of device offline/online states
- Test playlist synchronization with large playlists (>100 tracks)  
- Validate rate limit handling and retry logic
- Test playback state updates with various media types (tracks, podcasts, ads)
- Verify proper cleanup of polling timers and API connections