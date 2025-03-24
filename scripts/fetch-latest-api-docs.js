// scripts/fetch-latest-api-docs.js
const https = require('https');
const fs = require('fs');
const path = require('path');

// const API_KEY = 'A...............I';
const API_KEY = process.env.GEMINI_API_KEY; // ✅ Load from environment variable

// URLs for fetching Gemini API documentation
const GEMINI_API_DISCOVERY_URL = 'https://generativelanguage.googleapis.com/$discovery/rest';
const GEMINI_API_VERSION = 'v1beta';

/**
 * Fetches data from a URL and returns it as a promise
 * @param {string} url - The URL to fetch data from
 * @returns {Promise<object>} - The parsed JSON response
 */
function fetchData(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
                return reject(new Error(`Status Code: ${response.statusCode}`));
            }

            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                try {
                    const data = JSON.parse(Buffer.concat(chunks).toString());
                    resolve(data);
                } catch (error) {
                    reject(new Error(`Error parsing response: ${error.message}`));
                }
            });
        }).on('error', reject);
    });
}

/**
 * Extract method documentation and parameters from discovery document
 * @param {object} methods - Methods from discovery document
 * @returns {Array} - Array of processed method objects
 */
function processMethodsToEndpoints(methods, basePath) {
    const endpoints = [];

    for (const [methodName, methodData] of Object.entries(methods)) {
        // Skip methods that don't have a proper path
        if (!methodData.path) continue;

        const endpoint = {
            name: methodName,
            path: basePath + methodData.path,
            description: methodData.description || '',
            httpMethod: methodData.httpMethod || 'POST',
            parameters: [],
            responses: []
        };

        // Process parameters
        if (methodData.parameters) {
            for (const [paramName, paramData] of Object.entries(methodData.parameters)) {
                endpoint.parameters.push({
                    name: paramName,
                    type: paramData.type || 'string',
                    description: paramData.description || '',
                    required: !!paramData.required,
                    location: paramData.location || 'query'
                });
            }
        }

        // Add request body parameters if available
        if (methodData.request) {
            if (methodData.request.properties) {
                for (const [propName, propData] of Object.entries(methodData.request.properties)) {
                    endpoint.parameters.push({
                        name: propName,
                        type: propData.type || 'string',
                        description: propData.description || '',
                        required: methodData.request.required?.includes(propName) || false,
                        location: 'body'
                    });
                }
            }
        }

        // Add response data if available
        if (methodData.response) {
            endpoint.responses.push({
                status: 200,
                description: 'Successful response',
                schema: methodData.response
            });
        }

        endpoints.push(endpoint);
    }

    return endpoints;
}

/**
 * Extract resources and their methods from discovery document
 * @param {object} resources - Resources from discovery document
 * @param {string} basePath - Base API path
 * @returns {Array} - Array of processed endpoints
 */
function processResources(resources, basePath) {
    let endpoints = [];

    for (const [resourceName, resourceData] of Object.entries(resources)) {
        // Process methods in this resource
        if (resourceData.methods) {
            endpoints = endpoints.concat(processMethodsToEndpoints(resourceData.methods, basePath));
        }

        // Process nested resources
        if (resourceData.resources) {
            endpoints = endpoints.concat(processResources(resourceData.resources, basePath));
        }
    }

    return endpoints;
}

/**
 * Main function to fetch and process API documentation
 */
async function fetchLatestApiDocs() {
    try {
        console.log('Fetching Gemini API documentation...');

        // Fetch the discovery document
        const discoveryUrl = `${GEMINI_API_DISCOVERY_URL}?version=${GEMINI_API_VERSION}&key=${API_KEY}`;
        const discoveryData = await fetchData(discoveryUrl);

        console.log(`Retrieved API documentation for ${discoveryData.title} ${discoveryData.version}`);

        // Extract base information
        const apiInfo = {
            title: discoveryData.title,
            version: discoveryData.version,
            description: discoveryData.description,
            basePath: discoveryData.basePath,
            docLink: discoveryData.documentationLink,
            models: []
        };

        // Add gemini models
        const geminiModels = [
            {
                name: 'gemini-1.5-pro-latest',
                description: 'Latest version of Gemini 1.5 Pro',
                maxTokens: 8192,
                capabilities: ['text', 'code', 'chat', 'function-calling'],
                endpoints: []
            },
            {
                name: 'gemini-1.5-flash-latest',
                description: 'Latest version of Gemini 1.5 Flash',
                maxTokens: 8192,
                capabilities: ['text', 'code', 'chat', 'function-calling'],
                endpoints: []
            },
            {
                name: 'gemini-2.0-flash-exp-image-generation',
                description: 'Experimental Gemini 2.0 Flash model for image generation',
                maxTokens: 4096,
                capabilities: ['text', 'image-generation'],
                endpoints: []
            }
        ];

        // Process all endpoints from the resources
        if (discoveryData.resources) {
            const endpoints = processResources(discoveryData.resources, discoveryData.basePath);

            // Add endpoints to appropriate models based on capability
            for (const endpoint of endpoints) {
                for (const model of geminiModels) {
                    // Simple matching based on endpoint path and model capabilities
                    if (
                        (endpoint.path.includes('generateContent') && model.capabilities.includes('text')) ||
                        (endpoint.path.includes('generateImage') && model.capabilities.includes('image-generation')) ||
                        (endpoint.path.includes('chat') && model.capabilities.includes('chat')) ||
                        (endpoint.path.includes('embedContent') && model.capabilities.includes('text'))
                    ) {
                        model.endpoints.push(endpoint);
                    }
                }
            }
        }

        // Add models to API info
        apiInfo.models = geminiModels;

        // Also fetch schemas from the API if available
        if (discoveryData.schemas) {
            apiInfo.schemas = discoveryData.schemas;
        }

        // Save the processed data to docs-data.json
        const outputPath = path.join(__dirname, 'docs-data.json');
        fs.writeFileSync(outputPath, JSON.stringify(apiInfo, null, 2));

        console.log(`API documentation successfully saved to ${outputPath}`);
        return apiInfo;
    } catch (error) {
        console.error('Error fetching API documentation:', error);

        // Create a fallback minimal docs data if the fetch fails
        const fallbackData = createFallbackDocsData();
        const outputPath = path.join(__dirname, 'docs-data.json');
        fs.writeFileSync(outputPath, JSON.stringify(fallbackData, null, 2));

        console.log(`Created fallback documentation at ${outputPath}`);
        return fallbackData;
    }
}

/**
 * Creates fallback documentation data if API fetch fails
 * @returns {object} - Fallback documentation data
 */
function createFallbackDocsData() {
    return {
        title: "Gemini API",
        version: "v1beta",
        description: "Gemini API for language and multimodal models",
        basePath: "/v1beta",
        models: [
            {
                name: "gemini-1.5-pro-latest",
                description: "Latest version of Gemini 1.5 Pro",
                maxTokens: 8192,
                capabilities: ["text", "code", "chat", "function-calling"],
                endpoints: []
            },
            {
                name: "gemini-1.5-flash-latest",
                description: "Latest version of Gemini 1.5 Flash",
                maxTokens: 8192,
                capabilities: ["text", "code", "chat", "function-calling"],
                endpoints: []
            },
            {
                name: "gemini-2.0-flash-exp-image-generation",
                description: "Experimental Gemini 2.0 Flash model for image generation",
                maxTokens: 4096,
                capabilities: ["text", "image-generation"],
                endpoints: []
            }
        ]
    };
}

// Run the script if this is the main module
if (require.main === module) {
    fetchLatestApiDocs().catch(console.error);
}

module.exports = { fetchLatestApiDocs };