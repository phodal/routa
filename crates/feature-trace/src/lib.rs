pub mod analyzer;
pub mod catalog;
pub mod error;

pub use analyzer::{FeatureTraceInput, SessionAnalysis, SessionAnalyzer};
pub use catalog::{
    FeatureSurface, FeatureSurfaceCatalog, FeatureSurfaceKind, FeatureSurfaceLink,
    FeatureTreeCatalog, ProductFeature, ProductFeatureLink, SurfaceLinkConfidence,
};
pub use error::FeatureTraceError;
