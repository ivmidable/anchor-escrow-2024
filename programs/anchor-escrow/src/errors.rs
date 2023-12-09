use anchor_lang::error_code;

#[error_code]
pub enum EscrowError {
    #[msg("The amount stored in vault is less than the amount stored in Escrow!")]
    VaultAndEscrowInvalidAmount,
}
