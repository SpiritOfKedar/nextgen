import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { getFeatureBySlug } from '../data/features';
import { FeaturePage } from '../components/Landing/FeaturePage';

export const FeaturePageRoute: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();
    const feature = slug ? getFeatureBySlug(slug) : undefined;

    if (!feature) {
        return <Navigate to="/" replace />;
    }

    return <FeaturePage feature={feature} />;
};
