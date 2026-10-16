/** Shared public gaming relationship contract. No pod access or game ontology. */
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const NATIVE_OWNER_AGENT_GRANT_SCHEMA = freeze({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:interego:gaming:owner-agent-grant:v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "id",
    "issuer",
    "actor",
    "applicationId",
    "audience",
    "roomId",
    "entityId",
    "role",
    "actions",
    "notBefore",
    "expiresAt",
    "maxCommandsPerSecond",
    "revoked"
  ],
  "properties": {
    "schema": {
      "const": "interego.gaming.owner-agent-grant/v1"
    },
    "id": {
      "type": "string",
      "pattern": "^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "issuer": {
      "type": "string",
      "pattern": "^did:",
      "maxLength": 512
    },
    "actor": {
      "type": "string",
      "pattern": "^did:",
      "maxLength": 512
    },
    "applicationId": {
      "type": "string",
      "format": "uri",
      "maxLength": 512
    },
    "audience": {
      "type": "string",
      "format": "uri"
    },
    "roomId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "entityId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "role": {
      "enum": [
        "teammate",
        "pet",
        "coach"
      ]
    },
    "actions": {
      "type": "array",
      "minItems": 1,
      "maxItems": 4,
      "uniqueItems": true,
      "items": {
        "enum": [
          "observe",
          "move",
          "attack",
          "claimLoot"
        ]
      }
    },
    "notBefore": {
      "type": "string",
      "format": "date-time"
    },
    "expiresAt": {
      "type": "string",
      "format": "date-time"
    },
    "maxCommandsPerSecond": {
      "type": "integer",
      "minimum": 1,
      "maximum": 20
    },
    "revoked": {
      "type": "boolean"
    }
  },
  "allOf": [
    {
      "if": {
        "properties": {
          "role": {
            "const": "pet"
          }
        }
      },
      "then": {
        "properties": {
          "actions": {
            "items": {
              "enum": [
                "observe",
                "move",
                "attack"
              ]
            }
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "role": {
            "const": "coach"
          }
        }
      },
      "then": {
        "properties": {
          "actions": {
            "items": {
              "enum": [
                "observe"
              ]
            }
          }
        }
      }
    }
  ],
  "description": "Owner-pod primary gaming relationship. Verify native owner/current head/authorship/content before admission; lifetime is at most one hour. The server retains only its admission receipt/reference/scope. Revocation propagation is bounded by the advertised short game lease, not atomic across pods."
});
export const OWNER_AGENT_GRANT_SCHEMA = NATIVE_OWNER_AGENT_GRANT_SCHEMA;
export const OWNER_AGENT_GRANT_FIELDS = OWNER_AGENT_GRANT_SCHEMA.required;
export const OWNER_AGENT_GRANT_ROLES = freeze(Object.fromEntries(OWNER_AGENT_GRANT_SCHEMA.properties.role.enum.map(role => [role,
  OWNER_AGENT_GRANT_SCHEMA.allOf.find(rule => rule.if.properties.role.const === role)?.then.properties.actions.items.enum
  || OWNER_AGENT_GRANT_SCHEMA.properties.actions.items.enum])));
