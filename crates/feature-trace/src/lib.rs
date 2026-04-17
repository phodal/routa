pub mod analyzer;
pub mod catalog;
pub mod error;

pub use analyzer::{FeatureTraceInput, SessionAnalysis, SessionAnalyzer};
pub use catalog::{
    api_endpoints_from_openapi_contract, ApiEndpointDetail, CapabilityGroup, FeatureSurface,
    FeatureSurfaceCatalog, FeatureSurfaceKind, FeatureSurfaceLink, FeatureTreeCatalog,
    FrontendPageDetail, ProductFeature, ProductFeatureLink, SurfaceLinkConfidence,
};
pub use error::FeatureTraceError;
