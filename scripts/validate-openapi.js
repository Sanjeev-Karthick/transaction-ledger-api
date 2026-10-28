const SwaggerParser = require('@apidevtools/swagger-parser');

const path = require('node:path');

async function main() {
  await SwaggerParser.validate(path.join(__dirname, '../docs/openapi.json'));
  console.log('OpenAPI specification is valid');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
