import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Badge } from "./Badge";
import { Field, Input, Select, TextArea } from "./Input";

const meta = {
  title: "UI Kit/Icons & Primitives",
} satisfies Meta;

export default meta;

// Keep in sync with the ICONS map in Icon.tsx.
const ICON_NAMES = [
  "basis-logomark",
  "arrow-left",
  "arrow-out-of-box",
  "arrow-rotate",
  "chevron-right-small",
  "chevron-top",
  "circle-questionmark",
  "clapboard-sparkle",
  "clapboard-wide",
  "ellipsis",
  "finder",
  "folder",
  "folder-alt",
  "form-rectangle",
  "form-square",
  "github",
  "horizontal-align-bottom",
  "horizontal-align-center",
  "horizontal-align-top",
  "input-form",
  "layout-align-left",
  "linear",
  "magic-wand",
  "move-folder",
  "multi-media",
  "play-circle",
  "plus-large",
  "prompt",
  "record",
  "settings-gear",
  "share-os",
  "skip",
  "square-arrow-down",
  "step-back",
  "step-forwards",
  "text-motion",
  "trash-can",
  "vertical-align-center",
  "vertical-align-left",
  "vertical-align-right",
  "voice-high",
  "volume-full",
] as const;

export const IconGallery: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
      {ICON_NAMES.map((name) => (
        <div
          key={name}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            color: "var(--foreground-secondary)",
          }}
        >
          <Icon name={name} size={16} />
          <span>{name}</span>
        </div>
      ))}
    </div>
  ),
};

export const IconButtons: StoryObj = {
  render: () => (
    <div style={{ display: "flex", gap: 8 }}>
      <IconButton icon="settings-gear" label="Settings" />
      <IconButton icon="step-back" label="Undo" />
      <IconButton icon="step-forwards" label="Redo" disabled />
      <IconButton icon="ellipsis" size={12} label="Options" />
    </div>
  ),
};

export const Badges: StoryObj = {
  render: () => (
    <div style={{ display: "flex", gap: 8 }}>
      <Badge variant="neutral">Draft</Badge>
      <Badge variant="accent">Published</Badge>
    </div>
  ),
};

export const Fields: StoryObj = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 360 }}>
      <Field label="Title">
        <Input placeholder="e.g. Day in the life of startup engineer" />
      </Field>
      <Field label="What do you want to make?">
        <TextArea rows={3} placeholder="Describe the vibe, beats, hook, length..." />
      </Field>
      <Field label="Platform">
        <Select defaultValue="reels">
          <option value="reels">Instagram Reels</option>
          <option value="tiktok">TikTok</option>
        </Select>
      </Field>
    </div>
  ),
};
