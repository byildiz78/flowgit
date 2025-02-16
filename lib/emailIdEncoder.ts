// Basit bir encode/decode mekanizması
// Base64 + özel bir anahtar ile XOR işlemi yaparak ID'leri gizler

const ENCODE_KEY = 'flow_email_key_2024'; // Güvenlik için bu değeri environment variable'da saklayabilirsiniz

export function encodeEmailId(id: number): string {
    // ID'yi string'e çevir ve KEY ile birleştir
    const idStr = id.toString() + ENCODE_KEY;
    // Base64'e çevir ve URL safe yap
    const encoded = Buffer.from(idStr).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
    return encoded;
}

export function decodeEmailId(encoded: string): number {
    try {
        // URL safe base64'ü normal base64'e çevir
        const base64 = encoded
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        
        // Base64'den çöz
        const decoded = Buffer.from(base64, 'base64').toString();
        
        // KEY'i çıkar ve ID'yi al
        const id = parseInt(decoded.replace(ENCODE_KEY, ''));
        
        if (isNaN(id)) {
            throw new Error('Invalid encoded ID');
        }
        
        return id;
    } catch (error) {
        throw new Error('Failed to decode email ID');
    }
}
