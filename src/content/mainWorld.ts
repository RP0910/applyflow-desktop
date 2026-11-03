/**
 * Runs in the page's own JavaScript world (manifest "world": "MAIN") on dice.com.
 * Its only job is the file-chooser interception described in fileChooserInterceptor.ts,
 * which stays dormant unless ApplyFlow is attaching a document the user asked it to.
 */
import { installFileChooserInterceptor } from './fileChooserInterceptor';

installFileChooserInterceptor(HTMLInputElement.prototype);
