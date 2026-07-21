import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";

const meta = {
  title: "UI Kit/Button",
  component: Button,
  args: { children: "New workspace", variant: "primary", size: "sm" },
  argTypes: {
    variant: { control: "radio", options: ["primary", "secondary", "ghost"] },
    size: { control: "radio", options: ["sm", "md"] },
    icon: { control: false },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = { args: { variant: "secondary", children: "Back" } };

export const Ghost: Story = { args: { variant: "ghost", children: "Presets" } };

export const WithIcon: Story = { args: { icon: "plus-large", children: "New workspace" } };

export const Disabled: Story = { args: { disabled: true } };

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Button variant="primary" size="sm" icon="plus-large">
        Primary
      </Button>
      <Button variant="secondary" size="sm">
        Secondary
      </Button>
      <Button variant="ghost" size="sm" icon="magic-wand">
        Ghost
      </Button>
      <Button variant="primary" size="sm" disabled>
        Disabled
      </Button>
    </div>
  ),
};
