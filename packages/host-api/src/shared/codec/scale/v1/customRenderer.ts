import { Enum, OptionBool, Status, lazy } from '../primitives.js';
import type { Codec, CodecType } from 'scale-ts';
import { Option, Struct, Tuple, Vector, _void, bool, compact, str } from 'scale-ts';

const Size = compact;
const Dimensions = Tuple(Size, Size, Option(Size), Option(Size));

const TypographyStyle = Status('titleXL', 'headline', 'bodyM', 'bodyS', 'caption');

const ButtonVariant = Status('primary', 'secondary', 'text');

const ColorToken = Status(
  'textPrimary',
  'textSecondary',
  'textTertiary',
  'backgroundPrimary',
  'backgroundSecondary',
  'backgroundTertiary',
  'success',
  'error',
  'warning',
);

const ContentAlignment = Status(
  'topStart',
  'topCenter',
  'topEnd',
  'centerStart',
  'center',
  'centerEnd',
  'bottomStart',
  'bottomCenter',
  'bottomEnd',
);

const HorizontalAlignment = Status('start', 'center', 'end');

const VerticalAlignment = Status('top', 'center', 'bottom');

const Arrangement = Status('start', 'end', 'center', 'spaceBetween', 'spaceAround', 'spaceEvenly');

const Shape = Enum({
  Rounded: Size,
  Circle: _void,
});

const BorderStyle = Struct({
  width: Size,
  color: ColorToken,
  shape: Option(Shape),
});

const Modifier = Enum({
  margin: Dimensions,
  padding: Dimensions,
  background: Struct({
    color: ColorToken,
    shape: Option(Shape),
  }),
  border: BorderStyle,
  height: Size,
  width: Size,
  minWidth: Size,
  minHeight: Size,
  fillWidth: bool,
  fillHeight: bool,
});

type EnumVariants<T> = { [K in keyof T]: { tag: K; value: T[K] } }[keyof T];

const Children = lazy(() => CustomRendererNode);

type ComponentType<Props extends Codec<any>> = CodecType<ReturnType<typeof Component<Props>>>;
function Component<Props extends Codec<any>>(props: Props) {
  return Struct({
    modifiers: Vector(Modifier),
    props: props,
    children: Vector(Children),
  });
}

const BoxProps = Struct({
  contentAlignment: Option(ContentAlignment),
});

const ColumnProps = Struct({
  horizontalAlignment: Option(HorizontalAlignment),
  verticalArrangement: Option(Arrangement),
});

const RowProps = Struct({
  verticalAlignment: Option(VerticalAlignment),
  horizontalArrangement: Option(Arrangement),
});

const TextProps = Struct({
  style: Option(TypographyStyle),
  color: Option(ColorToken),
});

const ButtonProps = Struct({
  text: str,
  variant: Option(ButtonVariant),
  enabled: OptionBool,
  loading: OptionBool,
  clickAction: Option(str),
});

const TextFieldProps = Struct({
  text: str,
  placeholder: Option(str),
  label: Option(str),
  enabled: OptionBool,
  valueChangeAction: Option(str),
});

export type CustomRendererNodeType = EnumVariants<{
  Nil: undefined;
  String: string;
  Box: ComponentType<typeof BoxProps>;
  Column: ComponentType<typeof ColumnProps>;
  Row: ComponentType<typeof RowProps>;
  Spacer: ComponentType<typeof _void>;
  Text: ComponentType<typeof TextProps>;
  Button: ComponentType<typeof ButtonProps>;
  TextField: ComponentType<typeof TextFieldProps>;
}>;

export const CustomRendererNode: Codec<CustomRendererNodeType> = Enum({
  Nil: _void,
  String: str,
  Box: Component(BoxProps),
  Column: Component(ColumnProps),
  Row: Component(RowProps),
  Spacer: Component(_void),
  Text: Component(TextProps),
  Button: Component(ButtonProps),
  TextField: Component(TextFieldProps),
});
