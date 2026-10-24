export const findByPropsLazy = () => ({}); export const findStoreLazy = () => ({});
export const showToast = () => {}; export const UserStore = {}; export const SelectedChannelStore = {};
export const definePluginSettings = d => ({ store: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.default])) });
export const makeRange = () => []; export const OptionType = { BOOLEAN: 0, SLIDER: 1 };
