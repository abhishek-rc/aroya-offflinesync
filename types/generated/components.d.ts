import type { Schema, Struct } from '@strapi/strapi';

export interface ActivityDining extends Struct.ComponentSchema {
  collectionName: 'components_activity_dinings';
  info: {
    displayName: 'Dining';
  };
  attributes: {
    activity_media: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    amenties: Schema.Attribute.RichText;
    cuisine_type: Schema.Attribute.Text;
    description: Schema.Attribute.RichText;
    location: Schema.Attribute.RichText;
    menu_images: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    open_times: Schema.Attribute.RichText;
    policy: Schema.Attribute.RichText;
    service_type: Schema.Attribute.RichText;
    venue_type: Schema.Attribute.RichText;
  };
}

export interface ActivityShorex extends Struct.ComponentSchema {
  collectionName: 'components_activity_shorexes';
  info: {
    displayName: 'Excursion';
  };
  attributes: {
    activity_level: Schema.Attribute.String;
    activity_media: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    amenties: Schema.Attribute.RichText;
    duration: Schema.Attribute.String;
    full_description: Schema.Attribute.RichText;
    notes: Schema.Attribute.RichText;
    policy: Schema.Attribute.RichText;
    port_code: Schema.Attribute.String;
    short_description: Schema.Attribute.RichText;
  };
}

export interface ActivitySpaAndWellness extends Struct.ComponentSchema {
  collectionName: 'components_activity_spa_and_wellnesses';
  info: {
    displayName: 'Spa';
  };
  attributes: {
    activity_media: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    description: Schema.Attribute.RichText;
    duration: Schema.Attribute.String;
    treatment_type: Schema.Attribute.String;
  };
}

export interface CabinCabinBlock extends Struct.ComponentSchema {
  collectionName: 'components_cabin_cabin_blocks';
  info: {
    displayName: 'Cabin Type Detail';
  };
  attributes: {
    code: Schema.Attribute.Enumeration<
      [
        'RV',
        'PV',
        'SGS',
        'PFS',
        'GS',
        'PS',
        'SS',
        'SSA',
        'DS',
        'JS',
        'SES',
        'IDC',
        'BSCA',
        'BCA',
        'BSC',
        'BC',
        'SCA',
        'SSC',
        'SC',
        'ISCA',
        'IC',
      ]
    > &
      Schema.Attribute.Required;
    description: Schema.Attribute.Enumeration<
      [
        'Royal Villa',
        'Presidential Villa',
        'Signature Suite',
        'Premier Family Suite',
        'Grand Suite',
        'Premier Suite',
        'Superior Suite',
        'Superior Suite (ADA)',
        'Deluxe Suite',
        'Junior Suite',
        'Seaview Suite',
        'Interior Deluxe Cabin',
        'Balcony Superior Cabin (ADA)',
        'Balcony Cabin (ADA)',
        'Balcony Superior Cabin',
        'Balcony Cabin',
        'Seaview Cabin (ADA)',
        'Seaview Cabin',
        'Interior Cabin (ADA)',
      ]
    > &
      Schema.Attribute.Required;
    ship: Schema.Attribute.Enumeration<['AC01']> & Schema.Attribute.Required;
    virtual_image: Schema.Attribute.Text;
  };
}

export interface CabinCabinType extends Struct.ComponentSchema {
  collectionName: 'components_cabin_cabin_types';
  info: {
    displayName: 'Cabin Categories Detail';
  };
  attributes: {
    code: Schema.Attribute.Enumeration<
      [
        'INTERIOR',
        'SEAVIEW',
        'BALCONY',
        'AROYA-VILLAS',
        'AROYA-SUITES',
        'KHUZAMA',
      ]
    > &
      Schema.Attribute.Required;
    ship: Schema.Attribute.Enumeration<['AC01']> & Schema.Attribute.Required;
  };
}

export interface DestinationsCardDetails extends Struct.ComponentSchema {
  collectionName: 'components_destinations_card_details';
  info: {
    displayName: 'Card Details';
  };
  attributes: {
    card_title: Schema.Attribute.String;
    cta: Schema.Attribute.Component<'shared.button', true>;
    duration: Schema.Attribute.String;
    essentials: Schema.Attribute.Component<
      'destinations.important-points',
      true
    >;
    has_important_info: Schema.Attribute.Boolean;
    Image: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    imp_heading: Schema.Attribute.String;
    imp_logo: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    level: Schema.Attribute.String;
    long_description: Schema.Attribute.RichText;
    short_description: Schema.Attribute.RichText;
  };
}

export interface DestinationsCardSection extends Struct.ComponentSchema {
  collectionName: 'components_destinations_card_sections';
  info: {
    displayName: 'Card Section';
  };
  attributes: {
    category_title: Schema.Attribute.String;
    cta: Schema.Attribute.Component<'shared.button', true>;
    description: Schema.Attribute.RichText;
    has_category: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    has_logo: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    logo: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    media: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    title: Schema.Attribute.String;
  };
}

export interface DestinationsDestinationFeatureCard
  extends Struct.ComponentSchema {
  collectionName: 'components_destinations_destination_feature_cards';
  info: {
    displayName: 'Destination Feature Card';
  };
  attributes: {
    card_details: Schema.Attribute.Component<'destinations.card-details', true>;
    cta: Schema.Attribute.Component<'shared.button', true>;
    title: Schema.Attribute.Blocks;
  };
}

export interface DestinationsDestinationPorts extends Struct.ComponentSchema {
  collectionName: 'components_destinations_destination_ports';
  info: {
    displayName: 'Destination Ports';
  };
  attributes: {
    ports: Schema.Attribute.Component<'destinations.ports', true>;
  };
}

export interface DestinationsImportantPoints extends Struct.ComponentSchema {
  collectionName: 'components_destinations_important_points';
  info: {
    displayName: 'Important Points';
  };
  attributes: {
    points: Schema.Attribute.Component<'destinations.points', true>;
    title: Schema.Attribute.RichText;
  };
}

export interface DestinationsPoints extends Struct.ComponentSchema {
  collectionName: 'components_destinations_points';
  info: {
    displayName: 'points';
  };
  attributes: {
    image: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    point_description: Schema.Attribute.RichText;
  };
}

export interface DestinationsPorts extends Struct.ComponentSchema {
  collectionName: 'components_destinations_ports';
  info: {
    displayName: 'Ports';
  };
  attributes: {
    cta: Schema.Attribute.Component<'shared.button', true>;
    feature_image: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    port_details: Schema.Attribute.Relation<
      'oneToMany',
      'api::port-detail.port-detail'
    > &
      Schema.Attribute.Private;
    title: Schema.Attribute.RichText;
  };
}

export interface DestinationsService extends Struct.ComponentSchema {
  collectionName: 'components_destinations_services';
  info: {
    displayName: 'Service';
  };
  attributes: {
    service_name: Schema.Attribute.Component<'shared.rich-text', true>;
  };
}

export interface DestinationsTabSection extends Struct.ComponentSchema {
  collectionName: 'components_destinations_tab_sections';
  info: {
    displayName: 'Tab Section';
  };
  attributes: {
    cta: Schema.Attribute.Component<'shared.button', true>;
    description: Schema.Attribute.RichText;
    dimension: Schema.Attribute.String;
    essentials: Schema.Attribute.Component<'destinations.points', true>;
    has_dimension: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    media: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    title: Schema.Attribute.String;
  };
}

export interface DestinationsTabs extends Struct.ComponentSchema {
  collectionName: 'components_destinations_tabs';
  info: {
    displayName: 'Tabs';
  };
  attributes: {
    has_services: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    services: Schema.Attribute.Component<'destinations.service', true>;
    tab_title: Schema.Attribute.Component<'shared.button', false>;
    tabs: Schema.Attribute.Component<'destinations.tab-section', true>;
  };
}

export interface DestinationsVenueSection extends Struct.ComponentSchema {
  collectionName: 'components_destinations_venue_sections';
  info: {
    displayName: 'Venue Section';
  };
  attributes: {
    Title: Schema.Attribute.String;
    venues: Schema.Attribute.Component<'destinations.card-section', true>;
  };
}

export interface DestinationsVillasAndSuites extends Struct.ComponentSchema {
  collectionName: 'components_destinations_villas_and_suites';
  info: {
    displayName: 'Villas & Suites';
  };
  attributes: {
    section: Schema.Attribute.Component<'destinations.tabs', true>;
    title: Schema.Attribute.RichText;
  };
}

export interface EmbarkationEmbarkation extends Struct.ComponentSchema {
  collectionName: 'components_embarkation_embarkations';
  info: {
    displayName: 'Embarkation';
  };
  attributes: {
    embarkation: Schema.Attribute.Component<
      'embarkation.embarkation-table',
      true
    >;
  };
}

export interface EmbarkationEmbarkationTable extends Struct.ComponentSchema {
  collectionName: 'components_embarkation_embarkation_tables';
  info: {
    displayName: 'Embarkation Table';
  };
  attributes: {
    cabin_category: Schema.Attribute.String;
    cabin_code: Schema.Attribute.String;
    cabin_type: Schema.Attribute.RichText;
    embarkation_window: Schema.Attribute.String;
  };
}

export interface FaqFaqCategories extends Struct.ComponentSchema {
  collectionName: 'components_faq_faq_categories';
  info: {
    displayName: 'Faq Categories';
  };
  attributes: {
    category_title: Schema.Attribute.String & Schema.Attribute.Required;
    display_order: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    faq_items: Schema.Attribute.Component<'faq.faq-items', true>;
    is_active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
  };
}

export interface FaqFaqItems extends Struct.ComponentSchema {
  collectionName: 'components_faq_faq_items';
  info: {
    displayName: 'Faq Items';
  };
  attributes: {
    display_order: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    faq_answer: Schema.Attribute.Blocks & Schema.Attribute.Required;
    faq_question: Schema.Attribute.Blocks & Schema.Attribute.Required;
    is_active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
  };
}

export interface InformationInfo extends Struct.ComponentSchema {
  collectionName: 'components_information_infos';
  info: {
    displayName: 'info';
  };
  attributes: {
    info: Schema.Attribute.Component<'shared.info-section', true>;
  };
}

export interface OffersContent extends Struct.ComponentSchema {
  collectionName: 'components_offers_contents';
  info: {
    displayName: 'Content';
  };
  attributes: {
    offer_apply_link: Schema.Attribute.Text;
    offer_content: Schema.Attribute.RichText;
    offer_valid_until: Schema.Attribute.Date;
  };
}

export interface OffersMain extends Struct.ComponentSchema {
  collectionName: 'components_offers_mains';
  info: {
    displayName: 'Main';
  };
  attributes: {
    banner_title: Schema.Attribute.Text;
    desktop_image: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    mobile_image: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    title: Schema.Attribute.Text;
  };
}

export interface PackagesActivity extends Struct.ComponentSchema {
  collectionName: 'components_packages_activities';
  info: {
    displayName: 'Activity';
  };
  attributes: {
    long_description: Schema.Attribute.RichText;
    media: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    name: Schema.Attribute.RichText;
    shorex_code: Schema.Attribute.String & Schema.Attribute.Required;
    short_description: Schema.Attribute.RichText;
  };
}

export interface PackagesAddOn extends Struct.ComponentSchema {
  collectionName: 'components_packages_add_ons';
  info: {
    displayName: 'Add On';
  };
  attributes: {
    addOn_code: Schema.Attribute.String & Schema.Attribute.Required;
    description: Schema.Attribute.RichText;
    media: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    request_type: Schema.Attribute.Enumeration<
      [
        'ALL-INC',
        'ALL-INC-P',
        'ALL-INC-P-D',
        'ARCADE',
        'BUNDLE',
        'CHALLENGE-CHAMBERS',
        'CORPORATE',
        'DINNING',
        'DRINK',
        'ENTERTAINMENT',
        'F&B VENUES',
        'FOOD',
        'GIFT CARD',
        'GRAT',
        'HOTEL',
        'IN-CABIN-EXPERIENCE',
        'KIDS-CLUB',
        'LAUNDRY',
        'LOUNGE',
        'MINIBAR',
        'SPA',
        'TRANSFER',
        'WIFI',
        'ALLERGIES',
        'SPECIAL MEALS',
      ]
    >;
    title: Schema.Attribute.RichText;
  };
}

export interface PackagesExcursions extends Struct.ComponentSchema {
  collectionName: 'components_packages_excursions';
  info: {
    displayName: 'Excursions';
  };
  attributes: {
    Activity: Schema.Attribute.Component<'packages.activity', false>;
  };
}

export interface PackagesItinerary extends Struct.ComponentSchema {
  collectionName: 'components_packages_itineraries';
  info: {
    displayName: 'Itinerary';
  };
  attributes: {
    port_desc: Schema.Attribute.Component<
      'packages.package-image-and-text',
      false
    >;
  };
}

export interface PackagesPackageImageAndText extends Struct.ComponentSchema {
  collectionName: 'components_packages_package_image_and_texts';
  info: {
    displayName: 'Port';
  };
  attributes: {
    description: Schema.Attribute.RichText;
    media: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    port_code: Schema.Attribute.String & Schema.Attribute.Required;
    title: Schema.Attribute.RichText;
  };
}

export interface PackagesShip extends Struct.ComponentSchema {
  collectionName: 'components_packages_ships';
  info: {
    displayName: 'Ship';
  };
  attributes: {
    description: Schema.Attribute.RichText;
    gallery: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    ship_code: Schema.Attribute.String & Schema.Attribute.Required;
    ship_name: Schema.Attribute.String;
  };
}

export interface SharedButton extends Struct.ComponentSchema {
  collectionName: 'components_shared_buttons';
  info: {
    displayName: 'button';
  };
  attributes: {
    buttonBorderColor: Schema.Attribute.String &
      Schema.Attribute.CustomField<'plugin::color-picker.color'>;
    buttonBorderHoverColor: Schema.Attribute.String &
      Schema.Attribute.CustomField<'plugin::color-picker.color'>;
    buttonColor: Schema.Attribute.String &
      Schema.Attribute.CustomField<'plugin::color-picker.color'>;
    buttonHoverColor: Schema.Attribute.String &
      Schema.Attribute.CustomField<'plugin::color-picker.color'>;
    buttonTextColor: Schema.Attribute.String &
      Schema.Attribute.CustomField<'plugin::color-picker.color'>;
    link_url: Schema.Attribute.Text & Schema.Attribute.Required;
    text: Schema.Attribute.String & Schema.Attribute.Required;
    textHoverColor: Schema.Attribute.String &
      Schema.Attribute.CustomField<'plugin::color-picker.color'>;
  };
}

export interface SharedCardSection extends Struct.ComponentSchema {
  collectionName: 'components_shared_card_sections';
  info: {
    displayName: 'Card Section';
  };
  attributes: {
    heading: Schema.Attribute.RichText;
    section_items: Schema.Attribute.Component<'shared.media', true>;
  };
}

export interface SharedFaq extends Struct.ComponentSchema {
  collectionName: 'components_shared_faqs';
  info: {
    displayName: 'Faq';
  };
  attributes: {
    faq_categories: Schema.Attribute.Component<'faq.faq-categories', true>;
    faq_description: Schema.Attribute.Text;
    faq_title: Schema.Attribute.String;
  };
}

export interface SharedFeatureSection extends Struct.ComponentSchema {
  collectionName: 'components_shared_feature_sections';
  info: {
    displayName: 'Feature Section';
  };
  attributes: {
    description: Schema.Attribute.RichText;
    heading: Schema.Attribute.RichText;
    tab_items: Schema.Attribute.Component<'tab.tab-item', true>;
  };
}

export interface SharedFooterLegalLinks extends Struct.ComponentSchema {
  collectionName: 'components_shared_footer_legal_links_s';
  info: {
    displayName: 'Footer Legal Links ';
  };
  attributes: {
    label: Schema.Attribute.String;
    url: Schema.Attribute.String;
  };
}

export interface SharedGalleryItem extends Struct.ComponentSchema {
  collectionName: 'components_shared_gallery_items';
  info: {
    displayName: 'Gallery Item';
  };
  attributes: {
    has_tabs: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    media: Schema.Attribute.Component<'shared.media', true>;
    tab_name: Schema.Attribute.String;
  };
}

export interface SharedHeroBanner extends Struct.ComponentSchema {
  collectionName: 'components_shared_hero_banners';
  info: {
    displayName: 'Hero Banner';
  };
  attributes: {
    hero_banner: Schema.Attribute.Component<'shared.slider', true>;
  };
}

export interface SharedImageAndTextSection extends Struct.ComponentSchema {
  collectionName: 'components_shared_image_and_text_sections';
  info: {
    displayName: 'Image & Text Section';
  };
  attributes: {
    content_alignment: Schema.Attribute.Enumeration<
      ['start', 'center', 'end']
    > &
      Schema.Attribute.DefaultTo<'start'>;
    cta: Schema.Attribute.Component<'shared.button', true>;
    description: Schema.Attribute.RichText;
    description_1: Schema.Attribute.RichText;
    description_2: Schema.Attribute.RichText;
    description_3: Schema.Attribute.RichText;
    has_cta: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    has_description_1: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    has_description_2: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    has_description_3: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    image_position: Schema.Attribute.Enumeration<['left', 'right']> &
      Schema.Attribute.DefaultTo<'left'>;
    media: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    title: Schema.Attribute.RichText;
  };
}

export interface SharedInfoSection extends Struct.ComponentSchema {
  collectionName: 'components_shared_info_sections';
  info: {
    displayName: 'Info section';
  };
  attributes: {
    content: Schema.Attribute.Blocks & Schema.Attribute.Required;
    contentAlignment: Schema.Attribute.Enumeration<['left', 'right']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'left'>;
    heading: Schema.Attribute.RichText & Schema.Attribute.Required;
    headingAlignment: Schema.Attribute.Enumeration<['left', 'right']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'left'>;
    image: Schema.Attribute.Component<'shared.media', true>;
    tip: Schema.Attribute.Component<'shared.tip', true>;
  };
}

export interface SharedLegalLinks extends Struct.ComponentSchema {
  collectionName: 'components_shared_legal_links';
  info: {
    displayName: 'Legal Links';
  };
  attributes: {
    footer_legal_links: Schema.Attribute.Component<
      'shared.footer-legal-links',
      true
    >;
  };
}

export interface SharedMedia extends Struct.ComponentSchema {
  collectionName: 'components_shared_media';
  info: {
    displayName: 'Media';
    icon: 'file-video';
  };
  attributes: {
    category: Schema.Attribute.String;
    content: Schema.Attribute.RichText;
    cta: Schema.Attribute.Component<'shared.button', true>;
    has_category: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    has_content: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    has_cta: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    has_location_code: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    has_logo: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    has_short_content: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    has_title: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    has_virtual_image: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    image: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    imageDesktopAlignment: Schema.Attribute.Enumeration<
      ['left', 'right', 'center']
    > &
      Schema.Attribute.DefaultTo<'center'>;
    imageMobileAlignment: Schema.Attribute.Enumeration<['top', 'bottom']> &
      Schema.Attribute.DefaultTo<'top'>;
    location_code: Schema.Attribute.String;
    logo: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    need_alignment: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    short_content: Schema.Attribute.RichText;
    title: Schema.Attribute.String;
    virtual_image: Schema.Attribute.Text;
  };
}

export interface SharedOnboardingExperience extends Struct.ComponentSchema {
  collectionName: 'components_shared_onboarding_experiences';
  info: {
    displayName: 'Onboarding Experience';
  };
  attributes: {
    heading: Schema.Attribute.RichText;
    section_items: Schema.Attribute.Component<'shared.media', true>;
  };
}

export interface SharedQuote extends Struct.ComponentSchema {
  collectionName: 'components_shared_quotes';
  info: {
    displayName: 'Quote';
    icon: 'indent';
  };
  attributes: {
    body: Schema.Attribute.Text;
    title: Schema.Attribute.String;
  };
}

export interface SharedRichText extends Struct.ComponentSchema {
  collectionName: 'components_shared_rich_texts';
  info: {
    description: '';
    displayName: 'Rich text';
    icon: 'align-justify';
  };
  attributes: {
    content: Schema.Attribute.RichText;
    services_media: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios'
    >;
    title: Schema.Attribute.Text & Schema.Attribute.DefaultTo<'title'>;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    description: '';
    displayName: 'Seo';
    icon: 'allergies';
    name: 'Seo';
  };
  attributes: {
    metaDescription: Schema.Attribute.Text & Schema.Attribute.Required;
    metaTitle: Schema.Attribute.String & Schema.Attribute.Required;
    no_Archive: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    no_Follow: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    no_Index: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
  };
}

export interface SharedSlider extends Struct.ComponentSchema {
  collectionName: 'components_shared_sliders';
  info: {
    description: '';
    displayName: 'Slider';
    icon: 'address-book';
  };
  attributes: {
    cta_button: Schema.Attribute.Component<'shared.button', true>;
    description: Schema.Attribute.Blocks;
    desktop_image: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    heading: Schema.Attribute.Blocks;
    mobile_image: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    textAlign: Schema.Attribute.Enumeration<['left', 'center', 'right']> &
      Schema.Attribute.DefaultTo<'left'>;
  };
}

export interface SharedSocialLinks extends Struct.ComponentSchema {
  collectionName: 'components_shared_social_links';
  info: {
    displayName: 'Social Links';
  };
  attributes: {
    ariaLabel: Schema.Attribute.String;
    icon: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
    platform: Schema.Attribute.String;
    url: Schema.Attribute.String;
  };
}

export interface SharedTableSection extends Struct.ComponentSchema {
  collectionName: 'components_shared_table_sections';
  info: {
    displayName: 'Table section';
  };
  attributes: {
    table_fields: Schema.Attribute.JSON &
      Schema.Attribute.CustomField<'plugin::table-field.table'>;
    table_title: Schema.Attribute.Text;
  };
}

export interface SharedTip extends Struct.ComponentSchema {
  collectionName: 'components_shared_tips';
  info: {
    displayName: 'tip';
  };
  attributes: {
    tipText: Schema.Attribute.Text;
    tipType: Schema.Attribute.Enumeration<['proTip', 'tip']> &
      Schema.Attribute.DefaultTo<'tip'>;
  };
}

export interface TabTabItem extends Struct.ComponentSchema {
  collectionName: 'components_tab_tab_items';
  info: {
    displayName: 'Tab Item';
  };
  attributes: {
    tab_item: Schema.Attribute.Component<'shared.gallery-item', true>;
  };
}

export interface TestTestFaqCategories extends Struct.ComponentSchema {
  collectionName: 'components_test_test_faq_categories';
  info: {
    displayName: 'Test Faq Categories';
  };
  attributes: {
    category_heading: Schema.Attribute.String;
    test_faq_item: Schema.Attribute.Component<'test.test-faq-item', true>;
    test_media: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
  };
}

export interface TestTestFaqItem extends Struct.ComponentSchema {
  collectionName: 'components_test_test_faq_items';
  info: {
    displayName: 'Test Faq item';
  };
  attributes: {
    answers: Schema.Attribute.Blocks;
    markdown: Schema.Attribute.RichText;
    questions: Schema.Attribute.String;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'activity.dining': ActivityDining;
      'activity.shorex': ActivityShorex;
      'activity.spa-and-wellness': ActivitySpaAndWellness;
      'cabin.cabin-block': CabinCabinBlock;
      'cabin.cabin-type': CabinCabinType;
      'destinations.card-details': DestinationsCardDetails;
      'destinations.card-section': DestinationsCardSection;
      'destinations.destination-feature-card': DestinationsDestinationFeatureCard;
      'destinations.destination-ports': DestinationsDestinationPorts;
      'destinations.important-points': DestinationsImportantPoints;
      'destinations.points': DestinationsPoints;
      'destinations.ports': DestinationsPorts;
      'destinations.service': DestinationsService;
      'destinations.tab-section': DestinationsTabSection;
      'destinations.tabs': DestinationsTabs;
      'destinations.venue-section': DestinationsVenueSection;
      'destinations.villas-and-suites': DestinationsVillasAndSuites;
      'embarkation.embarkation': EmbarkationEmbarkation;
      'embarkation.embarkation-table': EmbarkationEmbarkationTable;
      'faq.faq-categories': FaqFaqCategories;
      'faq.faq-items': FaqFaqItems;
      'information.info': InformationInfo;
      'offers.content': OffersContent;
      'offers.main': OffersMain;
      'packages.activity': PackagesActivity;
      'packages.add-on': PackagesAddOn;
      'packages.excursions': PackagesExcursions;
      'packages.itinerary': PackagesItinerary;
      'packages.package-image-and-text': PackagesPackageImageAndText;
      'packages.ship': PackagesShip;
      'shared.button': SharedButton;
      'shared.card-section': SharedCardSection;
      'shared.faq': SharedFaq;
      'shared.feature-section': SharedFeatureSection;
      'shared.footer-legal-links': SharedFooterLegalLinks;
      'shared.gallery-item': SharedGalleryItem;
      'shared.hero-banner': SharedHeroBanner;
      'shared.image-and-text-section': SharedImageAndTextSection;
      'shared.info-section': SharedInfoSection;
      'shared.legal-links': SharedLegalLinks;
      'shared.media': SharedMedia;
      'shared.onboarding-experience': SharedOnboardingExperience;
      'shared.quote': SharedQuote;
      'shared.rich-text': SharedRichText;
      'shared.seo': SharedSeo;
      'shared.slider': SharedSlider;
      'shared.social-links': SharedSocialLinks;
      'shared.table-section': SharedTableSection;
      'shared.tip': SharedTip;
      'tab.tab-item': TabTabItem;
      'test.test-faq-categories': TestTestFaqCategories;
      'test.test-faq-item': TestTestFaqItem;
    }
  }
}
