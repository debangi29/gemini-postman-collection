// scripts/update-collections.js
const fs = require('fs');
const path = require('path');

function updateCollections() {
    try {
        // Read the docs data
        const docsData = JSON.parse(fs.readFileSync('./scripts/docs-data.json', 'utf8'));

        // Get list of collection files
        const collectionsDir = path.join(__dirname, '..', 'collections');
        const collectionFiles = fs.readdirSync(collectionsDir)
            .filter(file => file.endsWith('.json'));

        console.log(`Found ${collectionFiles.length} collection files to update`);

        // Model mapping for each collection
        const modelMapping = {
            'Gemini Chat.postman_collection.json': 'gemini-2.0-flash-lite-001',
            'Gemini Code Generation.postman_collection.json': 'gemini-2.0-flash-001',
            'Gemini Text Generation.postman_collection.json': 'gemini-2.0-pro-exp',
            'Gemini Image Understanding.postman_collection.json': 'gemini-1.5-pro-latest',
            'Gemini Image Generation.postman_collection.json': 'gemini-2.0-flash-exp-image-generation'
        };

        // Update each collection
        for (const file of collectionFiles) {
            const filePath = path.join(collectionsDir, file);
            const collection = JSON.parse(fs.readFileSync(filePath, 'utf8'));

            // Get the appropriate model for this collection
            const modelName = modelMapping[file];

            // Get the appropriate API documentation for this collection's model
            const modelDocs = docsData.models.find(model => model.name === modelName);
            const endpointDocs = modelDocs.endpoints;

            // Update collection metadata
            collection.info.lastUpdated = new Date().toISOString();

            // Find items that need updating
            updateCollectionItems(collection.item, endpointDocs, modelName);

            // Save the updated collection
            fs.writeFileSync(filePath, JSON.stringify(collection, null, 2));
            console.log(`Updated collection: ${file} with model: ${modelName}`);
        }

        console.log('All collections updated successfully');
    } catch (error) {
        console.error('Error updating collections:', error);
        process.exit(1);
    }
}

function updateCollectionItems(items, endpointDocs, modelName) {
    // Recursively process each item in the collection
    for (const item of items) {
        if (item.item && Array.isArray(item.item)) {
            updateCollectionItems(item.item, endpointDocs, modelName);
            continue;
        }

        // This is an actual request/endpoint
        if (item.request) {
            // Find matching endpoint documentation
            const endpoint = findMatchingEndpoint(item, endpointDocs);

            if (endpoint) {
                // Update request details based on endpoint documentation
                updateRequestWithEndpointDocs(item.request, endpoint, modelName);

                // Update tests based on expected responses
                updateTestScripts(item, endpoint);
            }
        }
    }
}

function findMatchingEndpoint(item, endpointDocs) {
    // Extract the endpoint name from the item name or URL
    const itemName = item.name.toLowerCase();
    const url = item.request?.url?.raw?.toLowerCase() || '';

    // Find a matching endpoint in the documentation
    return endpointDocs.find(endpoint => {
        const endpointPath = endpoint.path.toLowerCase();
        return itemName.includes(endpoint.name.toLowerCase()) || url.includes(endpointPath);
    });
}

function updateRequestWithEndpointDocs(request, endpoint, modelName) {
    // Update request description
    if (endpoint.description) {
        request.description = endpoint.description;
    }

    // Update request headers if needed
    if (endpoint.headers && Array.isArray(endpoint.headers)) {
        for (const header of endpoint.headers) {
            const existingHeader = request.header?.find(h => h.key === header.key);
            if (existingHeader) {
                existingHeader.value = header.value;
                existingHeader.description = header.description;
            } else if (request.header) {
                request.header.push(header);
            }
        }
    }

    // Update request body if it exists
    if (request.body?.mode === 'raw' && request.body?.options?.raw?.language === 'json') {
        try {
            const body = JSON.parse(request.body.raw);

            // Update the model field if it exists
            if (body.model) {
                body.model = modelName;
            }

            // Update other fields based on endpoint documentation
            if (endpoint.parameters) {
                for (const param of endpoint.parameters) {
                    if (param.required && !(param.name in body)) {
                        body[param.name] = param.defaultValue || '';
                    }
                }
            }

            request.body.raw = JSON.stringify(body, null, 2);
        } catch (e) {
            console.warn(`Could not parse JSON body for ${request.name}:`, e.message);
        }
    }
}

function updateTestScripts(item, endpoint) {
    // Update test scripts based on expected responses
    if (!item.event || !Array.isArray(item.event)) return;

    const testEvent = item.event.find(e => e.listen === 'test');
    if (!testEvent || !testEvent.script) return;

    // Check if there are existing tests we should preserve
    const existingTests = testEvent.script.exec || [];

    // Create updated test script that checks for status code and expected response format
    const updatedTests = [];

    // Add standard test for status code
    updatedTests.push(
        'pm.test("Status code is 200", function () {',
        '    pm.response.to.have.status(200);',
        '});'
    );

    // Add test for JSON response format
    updatedTests.push(
        'pm.test("Response is valid JSON", function () {',
        '    var jsonData = pm.response.json();',
        '    pm.expect(jsonData).to.be.an("object");',
        '});'
    );

    // Add endpoint-specific tests
    if (endpoint.responses && endpoint.responses.length > 0) {
        const successResponse = endpoint.responses.find(r => r.status === 200);

        if (successResponse && successResponse.schema) {
            // Add tests for expected response structure
            const schemaProps = Object.keys(successResponse.schema.properties || {});

            for (const prop of schemaProps) {
                updatedTests.push(
                    `pm.test("Response contains ${prop}", function () {`,
                    '    var jsonData = pm.response.json();',
                    `    pm.expect(jsonData).to.have.property("${prop}");`,
                    '});'
                );
            }
        }
    }

    // Update the test script
    testEvent.script.exec = updatedTests;
}

updateCollections();