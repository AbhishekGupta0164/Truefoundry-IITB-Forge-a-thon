/**
 * test/fixtures/debug-flag.ts
 *
 * Sample data for unit tests and fixtures only.
 * Isolated from production src/.
 */

export const ORIGINAL_DEBUG_FLAG = [
  'def get_debug_flag() -> bool:',
  '    """Get whether debug mode should be enabled for the app, indicated by the',
  '    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.',
  '    """',
  '    val = os.environ.get("FLASK_DEBUG")',
  '    return bool(val and val.lower() not in {"0", "false", "no"})'
].join('\n');

export const TRANSFORMED_DEBUG_FLAG = [
  'def get_debug_flag() -> bool:',
  '    """Get whether debug mode should be enabled for the app, indicated by the',
  '    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.',
  '    Values treated as false are: "0", "false", "no", "off", and "n" (case-insensitive).',
  '    """',
  '    val = os.environ.get("FLASK_DEBUG")',
  '    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})'
].join('\n');
