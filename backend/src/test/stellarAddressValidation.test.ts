import { describe, it, expect } from 'vitest'
import { Keypair } from '@stellar/stellar-sdk'
import { isValidStellarPublicKey, stellarAddressSchema } from '../api/validation.js'

describe('isValidStellarPublicKey', () => {
    it('accepts a real Stellar ed25519 public key', () => {
        const pub = Keypair.random().publicKey()
        expect(isValidStellarPublicKey(pub)).toBe(true)
    })

    it('rejects an arbitrary non-empty string', () => {
        expect(isValidStellarPublicKey('not-a-stellar-address')).toBe(false)
    })

    it('rejects a key with an invalid checksum', () => {
        const pub = Keypair.random().publicKey()
        // Flip the last character to break the CRC16 checksum.
        const tampered = pub.slice(0, -1) + (pub.endsWith('A') ? 'B' : 'A')
        expect(isValidStellarPublicKey(tampered)).toBe(false)
    })

    it('rejects a secret seed (S...) used in place of a public key', () => {
        const secret = Keypair.random().secret()
        expect(isValidStellarPublicKey(secret)).toBe(false)
    })

    it('rejects non-string values', () => {
        expect(isValidStellarPublicKey(undefined)).toBe(false)
        expect(isValidStellarPublicKey(null)).toBe(false)
        expect(isValidStellarPublicKey(12345)).toBe(false)
        expect(isValidStellarPublicKey('')).toBe(false)
    })
})

describe('stellarAddressSchema', () => {
    it('parses a valid Stellar public key', () => {
        const pub = Keypair.random().publicKey()
        expect(stellarAddressSchema.parse(pub)).toBe(pub)
    })

    it('fails on an invalid address', () => {
        const result = stellarAddressSchema.safeParse('not-a-stellar-address')
        expect(result.success).toBe(false)
    })
})
