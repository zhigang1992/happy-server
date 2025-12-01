import { z } from "zod";
import { type Fastify } from "../types";
import { log } from "@/utils/log";

/**
 * Voice routes for ElevenLabs Conversational AI integration.
 *
 * Required environment variables:
 * - ELEVENLABS_API_KEY: Your ElevenLabs API key
 * - ELEVENLABS_AGENT_ID: Your ElevenLabs Conversational AI agent ID
 *
 * In development mode (ENV=dev), RevenueCat subscription check is skipped.
 */
export function voiceRoutes(app: Fastify) {
    app.post('/v1/voice/token', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                revenueCatPublicKey: z.string().optional()
            }),
            response: {
                200: z.object({
                    allowed: z.boolean(),
                    token: z.string().optional(),
                    agentId: z.string().optional()
                }),
                400: z.object({
                    allowed: z.boolean(),
                    error: z.string()
                })
            }
        }
    }, async (request, reply) => {
        const userId = request.userId; // CUID from JWT
        const { revenueCatPublicKey } = request.body;

        log({ module: 'voice' }, `Voice token request from user ${userId}`);

        const isDevelopment = process.env.NODE_ENV === 'development' || process.env.ENV === 'dev';

        // Production requires RevenueCat key
        if (!isDevelopment && !revenueCatPublicKey) {
            log({ module: 'voice' }, 'Production environment requires RevenueCat public key');
            return reply.code(400).send({
                allowed: false,
                error: 'RevenueCat public key required'
            });
        }

        // Check subscription in production
        if (!isDevelopment && revenueCatPublicKey) {
            const response = await fetch(
                `https://api.revenuecat.com/v1/subscribers/${userId}`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${revenueCatPublicKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!response.ok) {
                log({ module: 'voice' }, `RevenueCat check failed for user ${userId}: ${response.status}`);
                return reply.send({
                    allowed: false
                });
            }

            const data = await response.json() as any;
            const proEntitlement = data.subscriber?.entitlements?.active?.pro;

            if (!proEntitlement) {
                log({ module: 'voice' }, `User ${userId} does not have active subscription`);
                return reply.send({
                    allowed: false
                });
            }
        }

        // Check if 11Labs API key is configured
        const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
        if (!elevenLabsApiKey) {
            log({ module: 'voice' }, 'Missing ELEVENLABS_API_KEY environment variable');
            return reply.code(400).send({ allowed: false, error: 'Voice not configured on server (missing API key)' });
        }

        // Check if agent ID is configured
        const agentId = process.env.ELEVENLABS_AGENT_ID;
        if (!agentId) {
            log({ module: 'voice' }, 'Missing ELEVENLABS_AGENT_ID environment variable');
            return reply.code(400).send({ allowed: false, error: 'Voice not configured on server (missing agent ID)' });
        }

        // Get 11Labs conversation token (for WebRTC connections)
        const response = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`,
            {
                method: 'GET',
                headers: {
                    'xi-api-key': elevenLabsApiKey,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            log({ module: 'voice' }, `Failed to get 11Labs token: ${response.status} ${errorText}`);

            // Parse error for better user feedback
            let errorDetail = 'Failed to get voice token from ElevenLabs';
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.detail?.message) {
                    errorDetail = errorJson.detail.message;
                } else if (errorJson.detail?.status) {
                    errorDetail = `ElevenLabs error: ${errorJson.detail.status}`;
                }
            } catch {
                // Use default error message
            }

            return reply.code(400).send({
                allowed: false,
                error: errorDetail
            });
        }

        const data = await response.json() as any;
        const token = data.token;

        if (!token) {
            log({ module: 'voice' }, 'ElevenLabs returned empty token');
            return reply.code(400).send({
                allowed: false,
                error: 'ElevenLabs returned invalid response'
            });
        }

        log({ module: 'voice' }, `Voice token issued for user ${userId}`);
        return reply.send({
            allowed: true,
            token,
            agentId
        });
    });
}