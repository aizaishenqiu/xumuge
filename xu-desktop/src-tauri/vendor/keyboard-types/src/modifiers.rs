//! Modifier key data.
//!
//! Modifier keys like Shift and Control alter the character value
//! and are used in keyboard shortcuts.
//!
//! Use the constants to match for combinations of the modifier keys.
//!
//! @updated 2026-09-01 — LTO-safe manual serde (bits as u32)

bitflags::bitflags! {
    /// Pressed modifier keys.
    ///
    /// Specification:
    /// <https://w3c.github.io/uievents-key/#keys-modifier>
    #[derive(Debug, Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
    pub struct Modifiers: u32 {
        const ALT = 0x01;
        const ALT_GRAPH = 0x2;
        const CAPS_LOCK = 0x4;
        const CONTROL = 0x8;
        const FN = 0x10;
        const FN_LOCK = 0x20;
        const META = 0x40;
        const NUM_LOCK = 0x80;
        const SCROLL_LOCK = 0x100;
        const SHIFT = 0x200;
        const SYMBOL = 0x400;
        const SYMBOL_LOCK = 0x800;
        const HYPER = 0x1000;
        const SUPER = 0x2000;
    }
}

#[cfg(feature = "serde")]
impl serde::Serialize for Modifiers {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u32(self.bits())
    }
}

#[cfg(feature = "serde")]
impl<'de> serde::Deserialize<'de> for Modifiers {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let bits = <u32 as serde::Deserialize>::deserialize(deserializer)?;
        Ok(Modifiers::from_bits_truncate(bits))
    }
}

impl Modifiers {
    /// Return `true` if a shift key is pressed.
    pub fn shift(&self) -> bool {
        self.contains(Modifiers::SHIFT)
    }

    /// Return `true` if a control key is pressed.
    pub fn ctrl(&self) -> bool {
        self.contains(Modifiers::CONTROL)
    }

    /// Return `true` if an alt key is pressed.
    pub fn alt(&self) -> bool {
        self.contains(Modifiers::ALT)
    }

    /// Return `true` if a meta key is pressed.
    pub fn meta(&self) -> bool {
        self.contains(Modifiers::META)
    }
}
