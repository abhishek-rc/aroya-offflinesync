import shipRegistry from './ship-registry/schema.json';
import processedMessage from './processed-message/schema.json';
import deadLetter from './dead-letter/schema.json';
import documentMapping from './document-mapping/schema.json';

export default {
    'ship-registry': { schema: shipRegistry },
    'processed-message': { schema: processedMessage },
    'dead-letter': { schema: deadLetter },
    'document-mapping': { schema: documentMapping },
};
